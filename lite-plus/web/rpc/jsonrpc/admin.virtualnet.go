package jsonrpc

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/nuomiiiii/lite/database/auditlog"
	"github.com/nuomiiiii/lite/database/clients"
	"github.com/nuomiiiii/lite/database/dbcore"
	"github.com/nuomiiiii/lite/pkg/rpc"
	"github.com/nuomiiiii/lite/virtualnet"
	agent_runtime "github.com/nuomiiiii/lite/web/agent"
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
	reg("virtualnet.jobs", virtualnetJobs, "List sanitized provisioning status")
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
	if e := dbcore.GetDBInstance().Find(&rows).Error; e != nil {
		return nil, virtualnetError(errors.New("profile query failed"))
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
	if e := dbcore.GetDBInstance().Delete(&virtualnet.Profile{}, "peer_id = ?", q.PeerID).Error; e != nil {
		return nil, virtualnetError(errors.New("delete failed"))
	}
	virtualnetAudit(ctx, "delete SSH credentials", q.PeerID)
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
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is already running"))
	}
	p, e := loadVirtualnetProfile(ctx, req)
	if e != nil {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(e)
	}
	endpoint, e := virtualnet.Endpoint()
	if e != nil {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(e)
	}
	if p.NodeUUID != "" {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(errors.New("this peer already has a managed Node; automatic replacement is disabled"))
	}
	db := dbcore.GetDBInstance()
	job := virtualnet.Job{ID: uuid.NewString(), PeerID: p.PeerID, Status: "running", Stage: "preflight"}
	if e := db.Create(&job).Error; e != nil {
		virtualnetDeployment.Unlock()
		return nil, virtualnetError(errors.New("could not create deployment job"))
	}
	virtualnetAudit(ctx, "deploy Node", p.PeerID)
	go func() {
		defer virtualnetDeployment.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		update := func(status, stage, message string) {
			db.Model(&virtualnet.Job{}).Where("id = ?", job.ID).Updates(map[string]any{"status": status, "stage": stage, "error": message, "node_uuid": p.NodeUUID})
		}
		if e := virtualnet.Preflight(ctx, p); e != nil {
			update("failed", "preflight", e.Error())
			return
		}
		id, token, e := clients.CreateClientWithName("EasyTier-" + p.PeerID)
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
		compose, e := virtualnet.Compose(token, endpoint)
		if e != nil {
			update("failed", "compose", e.Error())
			return
		}
		update("running", "compose", "")
		if e := virtualnet.Deploy(ctx, p, compose); e != nil {
			update("failed", "compose", e.Error()+"; partial installation is preserved; inspect /opt/enb/node before retrying")
			return
		}
		update("running", "awaiting_agent", "")
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				update("failed", "awaiting_agent", "container started but agent did not connect; verify virtual control URL and TLS")
				return
			case <-ticker.C:
				if agent_runtime.IsAgentOnline(id) {
					update("succeeded", "online", "")
					return
				}
			}
		}
	}()
	return job, nil
}
