package jsonrpc

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/nuomiiiii/lite/database/auditlog"
	"github.com/nuomiiiii/lite/database/clients"
	"github.com/nuomiiiii/lite/database/dbcore"
	"github.com/nuomiiiii/lite/pkg/releasefeed"
	"github.com/nuomiiiii/lite/pkg/rpc"
	"github.com/nuomiiiii/lite/utils"
	logger "github.com/nuomiiiii/lite/utils/log"
	"github.com/nuomiiiii/lite/virtualnet"
	agent_runtime "github.com/nuomiiiii/lite/web/agent"
	"github.com/nuomiiiii/lite/web/hostctl"
)

var virtualnetDeployment sync.Mutex

func init() {
	reg("virtualnet.discover", virtualnetDiscover, "Read EasyTier virtual peers (configuration is read only)")
	reg("virtualnet.fingerprint", virtualnetFingerprint, "Probe a peer SSH key without credentials; independently verify before trusting")
	reg("virtualnet.profiles", virtualnetProfiles, "List SSH profiles without secrets")
	reg("virtualnet.save", virtualnetSave, "Encrypt and save peer SSH credentials")
	reg("virtualnet.delete", virtualnetDelete, "Delete saved SSH credentials (does not remove remote Node)")
	reg("virtualnet.test", virtualnetTest, "Verify pinned SSH identity and Docker Compose privileges")
	reg("virtualnet.deploy", virtualnetDeploy, "Explicitly provision a new Node via SSH and Docker Compose")
	reg("virtualnet.inspect", virtualnetInspection, "Inspect managed installation before explicit deployment confirmation")
	reg("virtualnet.pause", virtualnetPause, "Withdraw managed Compose while retaining installation data and panel association")
	reg("virtualnet.resume", virtualnetResume, "Pull and start retained Node Compose without replacing its data")
	reg("virtualnet.jobs", virtualnetJobs, "List sanitized provisioning status")
	reg("virtualnet.settings", virtualnetSettings, "Read Node deployment control endpoint settings")
	reg("virtualnet.settings.save", virtualnetSettingsSave, "Save Node deployment settings; does not modify EasyTier or existing Nodes")
}

func virtualnetSettings(ctx context.Context, _ *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	s, err := virtualnet.LoadSettings(dbcore.GetDBInstance())
	if err != nil {
		return nil, virtualnetError(err)
	}
	return s, nil
}

func virtualnetSettingsSave(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is in progress"))
	}
	defer virtualnetDeployment.Unlock()
	var s virtualnet.Settings
	if err := req.BindParams(&s); err != nil {
		return nil, virtualnetError(errors.New("invalid request"))
	}
	if err := virtualnet.SaveSettings(dbcore.GetDBInstance(), s); err != nil {
		return nil, virtualnetError(err)
	}
	virtualnetAudit(ctx, "save Node deployment settings", "control endpoint")
	return map[string]bool{"saved": true}, nil
}

func virtualnetError(err error) *rpc.JsonRpcError {
	return rpc.MakeError(rpc.InvalidParams, err.Error(), nil)
}
func virtualnetAudit(ctx context.Context, action, target string) {
	actor, ip := auditActor(ctx)
	auditlog.Event(ip, actor, "info", "audit.virtualnet", map[string]string{"action": action, "target": target})
}

func virtualnetDiscover(ctx context.Context, _ *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	d, e := virtualnet.Discover(ctx)
	if e != nil {
		return nil, virtualnetError(e)
	}
	return d, nil
}
func virtualnetProfiles(ctx context.Context, _ *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var rows []virtualnet.Profile
	if err := virtualnet.ReconcileNodeAssociations(dbcore.GetDBInstance()); err != nil {
		return nil, virtualnetError(errors.New("could not refresh Node associations"))
	}
	if e := dbcore.GetDBInstance().Find(&rows).Error; e != nil {
		return nil, virtualnetError(errors.New("profile query failed"))
	}
	for i := range rows {
		rows[i].HasCredentials = rows[i].CredentialsPresent()
	}
	return rows, nil
}
func virtualnetFingerprint(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var p virtualnet.ProfileInput
	if e := req.BindParams(&p); e != nil {
		return nil, virtualnetError(errors.New("invalid request"))
	}
	if _, e := virtualnet.FindPeer(ctx, p.PeerID, p.Address); e != nil {
		return nil, virtualnetError(e)
	}
	fp, e := virtualnet.Fingerprint(ctx, p.Address, p.Port)
	if e != nil {
		return nil, virtualnetError(e)
	}
	return map[string]string{"fingerprint": fp, "warning": "Independently verify this fingerprint before saving credentials."}, nil
}
func virtualnetSave(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is in progress"))
	}
	defer virtualnetDeployment.Unlock()
	var p virtualnet.ProfileInput
	if e := req.BindParams(&p); e != nil {
		return nil, virtualnetError(errors.New("invalid request"))
	}
	if _, e := virtualnet.FindPeer(ctx, p.PeerID, p.Address); e != nil {
		return nil, virtualnetError(e)
	}
	if e := virtualnet.SaveProfile(dbcore.GetDBInstance(), p); e != nil {
		return nil, virtualnetError(e)
	}
	virtualnetAudit(ctx, "save SSH credentials", p.PeerID)
	hostctl.ClosePeer(p.PeerID)
	return map[string]bool{"saved": true}, nil
}
func loadVirtualnetProfile(ctx context.Context, req *rpc.JsonRpcRequest) (virtualnet.Profile, error) {
	var q struct {
		PeerID string `json:"peer_id"`
	}
	if e := req.BindParams(&q); e != nil {
		return virtualnet.Profile{}, errors.New("invalid request")
	}
	var p virtualnet.Profile
	if e := dbcore.GetDBInstance().First(&p, "peer_id = ?", q.PeerID).Error; e != nil {
		return p, errors.New("SSH profile not found")
	}
	if !p.CredentialsPresent() {
		return p, errors.New("configure SSH credentials first")
	}
	_, e := virtualnet.FindPeer(ctx, p.PeerID, p.Address)
	return p, e
}
func virtualnetDelete(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var q struct {
		PeerID string `json:"peer_id"`
	}
	if e := req.BindParams(&q); e != nil {
		return nil, virtualnetError(errors.New("invalid request"))
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is in progress"))
	}
	defer virtualnetDeployment.Unlock()
	if e := virtualnet.ForgetCredentials(dbcore.GetDBInstance(), q.PeerID); e != nil {
		return nil, virtualnetError(errors.New("delete failed"))
	}
	virtualnetAudit(ctx, "delete SSH credentials", q.PeerID)
	hostctl.ClosePeer(q.PeerID)
	return map[string]bool{"deleted": true}, nil
}
func virtualnetTest(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	p, e := loadVirtualnetProfile(ctx, req)
	if e != nil {
		return nil, virtualnetError(e)
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	e = virtualnet.Test(ctx, p)
	virtualnetAudit(ctx, "test SSH connection", p.PeerID)
	if e != nil {
		return nil, virtualnetError(e)
	}
	return map[string]bool{"ok": true}, nil
}
func virtualnetJobs(ctx context.Context, _ *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var rows []virtualnet.Job
	if e := dbcore.GetDBInstance().Order("created_at DESC").Limit(50).Find(&rows).Error; e != nil {
		return nil, virtualnetError(errors.New("job query failed"))
	}
	return rows, nil
}
func virtualnetDeploy(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var options struct {
		ConfirmationToken  string `json:"confirmation_token"`
		OverwriteConfirmed bool   `json:"overwrite_confirmed"`
	}
	if e := req.BindParams(&options); e != nil {
		return nil, virtualnetError(errors.New("invalid request"))
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is already running"))
	}
	p, e := loadVirtualnetProfile(ctx, req)
	if e != nil {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(e)
	}
	peer, e := virtualnet.FindPeer(ctx, p.PeerID, p.Address)
	if e != nil {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(e)
	}
	settings, e := virtualnet.LoadSettings(dbcore.GetDBInstance())
	if e != nil {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(e)
	}
	if _, e := settings.Endpoint(); e != nil {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(e)
	}
	if e := consumeVirtualnetConfirmation(ctx, options.ConfirmationToken, p, settings, options.OverwriteConfirmed); e != nil {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(e)
	}
	db := dbcore.GetDBInstance()
	job := virtualnet.Job{ID: uuid.NewString(), PeerID: p.PeerID, Status: "running", Stage: "preflight"}
	if e := db.Create(&job).Error; e != nil {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(errors.New("could not create deployment job"))
	}
	if options.OverwriteConfirmed {
		virtualnetAudit(ctx, "force overwrite managed Node", p.PeerID)
	} else {
		virtualnetAudit(ctx, "deploy Node", p.PeerID)
	}
	go func() {
		defer virtualnetDeployment.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		update := func(status, stage, message string) bool {
			if e := virtualnet.UpdateJob(db, job.ID, p.NodeUUID, status, stage, message); e != nil {
				logger.Errorf("virtualnet", "Deployment %s: status persistence failed at %s; execution stopped, inspect remote installation", job.ID, stage)
				return false
			}
			return true
		}
		installation, e := virtualnet.InspectInstallation(ctx, p)
		if e != nil {
			update("failed", "preflight", e.Error())
			return
		}
		if installation.Existing() && !options.OverwriteConfirmed {
			update("failed", "preflight", "installation changed; inspect and confirm overwrite again")
			return
		}
		var id, token string
		// Force a fresh trusted catalog before registering a Node or touching
		// remote data. Freeze the chosen digest for this entire transaction.
		releases, _, e := releasefeed.Fetch(ctx, "node", true)
		if e != nil {
			update("failed", "release_check", "could not read Node release catalog; deployment stopped")
			return
		}
		release, e := releasefeed.LatestNodeForInstall(releases, utils.CurrentVersion, "linux/amd64")
		if e != nil {
			update("failed", "release_check", e.Error())
			return
		}
		if !update("running", "image_acquisition", "") {
			return
		}
		var profiles []virtualnet.Profile
		var policies []virtualnet.Policy
		var donors []virtualnet.Profile
		if db.Find(&profiles).Error == nil && db.Find(&policies).Error == nil {
			if discovery, err := virtualnet.Discover(ctx); err == nil {
				donors = virtualnet.RelayCandidates(discovery.Peers, profiles, policies, p.PeerID)
			}
		}
		preparedImage, e := virtualnet.EnsureDeploymentImage(ctx, p, donors, release)
		if e != nil {
			update("failed", "image_acquisition", e.Error())
			return
		}
		if p.NodeUUID != "" {
			id = p.NodeUUID
			token, e = clients.GetClientTokenByUUID(id)
		} else {
			id, token, e = clients.CreateClientWithName(peer.NodeName())
		}
		if e != nil {
			update("failed", "registration", "could not register Node")
			return
		}
		p.NodeUUID = id
		// Persist the association before touching the remote host. Retain it on failure for investigation;
		// never create a second token or silently overwrite a partial installation on retry.
		if e := db.Model(&virtualnet.Profile{}).Where("peer_id = ?", p.PeerID).Update("node_uuid", id).Error; e != nil {
			update("failed", "registration", "could not save Node association")
			return
		}
		compose, e := virtualnet.ComposeRelease(token, settings, release)
		compose = strings.Replace(compose, "image: "+release.Image, "image: "+preparedImage, 1)
		if e != nil {
			update("failed", "compose", e.Error())
			return
		}
		if !update("running", "compose", "") {
			return
		}
		previousConnection, _ := agent_runtime.ActiveConnectionID(id)
		if e := virtualnet.DeployPrepared(ctx, p, compose, options.OverwriteConfirmed); e != nil {
			update("failed", "compose", e.Error()+"; partial installation is preserved; inspect enb/node in the SSH login user's home before retrying")
			return
		}
		if e := db.Model(&virtualnet.Profile{}).Where("peer_id = ?", p.PeerID).Update("paused", false).Error; e != nil {
			update("failed", "compose", "container started but deployment state could not be saved")
			return
		}
		if !update("running", "awaiting_agent", "") {
			return
		}
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				update("failed", "awaiting_agent", "container started but agent did not connect; verify virtual control URL and TLS")
				return
			case <-ticker.C:
				connection, online := agent_runtime.ActiveConnectionID(id)
				if online && (previousConnection == 0 || connection != previousConnection) {
					update("succeeded", "online", "")
					return
				}
			}
		}
	}()
	return job, nil
}
