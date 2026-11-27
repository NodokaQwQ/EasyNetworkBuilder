package jsonrpc

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/nuomiiiii/lite/database/clients"
	"github.com/nuomiiiii/lite/database/dbcore"
	"github.com/nuomiiiii/lite/pkg/releasefeed"
	"github.com/nuomiiiii/lite/pkg/rpc"
	"github.com/nuomiiiii/lite/utils"
	"github.com/nuomiiiii/lite/virtualnet"
	agent_runtime "github.com/nuomiiiii/lite/web/agent"
)

func init() {
	reg("virtualnet.node.releases", virtualnetNodeReleases, "Read approved ENB Node images and current Agent version")
	reg("virtualnet.node.update", virtualnetNodeUpdate, "Explicitly upgrade a managed Node preserving configuration and snapshots")
}

func virtualnetNodeReleases(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	p, err := loadVirtualnetProfile(ctx, req)
	if err != nil {
		return nil, virtualnetError(err)
	}
	var options struct {
		Force bool `json:"force"`
	}
	if err := req.BindParams(&options); err != nil {
		return nil, virtualnetError(err)
	}
	releases, checked, feedErr := releasefeed.Fetch(ctx, "node", options.Force)
	result := map[string]any{"releases": []releasefeed.Release{}, "checked_at": checked, "supported": p.NodeUUID != "" && !p.Paused && p.CredentialsPresent(), "scope": "managed ~/enb/node only; SSH preflight required"}
	if feedErr != nil {
		result["check_error"] = feedErr.Error()
	}
	if p.NodeUUID != "" {
		if node, e := clients.GetClientByUUID(p.NodeUUID); e == nil {
			result["current_version"] = node.Version
			compatible := []releasefeed.Release{}
			for _, release := range releases {
				if release.Compatible(node.Version, utils.CurrentVersion, "linux/amd64") {
					compatible = append(compatible, release)
				}
			}
			result["releases"] = compatible
		}
	}
	return result, nil
}

func virtualnetNodeUpdate(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var in struct {
		virtualnetHostAuth
		Version   string `json:"version"`
		Image     string `json:"image"`
		Confirmed bool   `json:"confirmed"`
	}
	if err := req.BindParams(&in); err != nil || !in.Confirmed {
		return nil, virtualnetError(errors.New("explicit Node downtime and snapshot rollback confirmation required"))
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is in progress"))
	}
	locked := true
	defer func() {
		if locked {
			virtualnetDeployment.Unlock()
		}
	}()
	p, err := loadVirtualnetProfile(ctx, req)
	if err != nil {
		return nil, virtualnetError(err)
	}
	if p.NodeUUID == "" || p.Paused {
		return nil, virtualnetError(errors.New("associated running managed Node required"))
	}
	db := dbcore.GetDBInstance()
	policy, err := virtualnet.LoadPolicy(db, p.PeerID)
	if err != nil {
		return nil, virtualnetError(err)
	}
	if !policy.NodeDocker {
		return nil, virtualnetError(errors.New("managed Node Docker permission required"))
	}
	node, err := clients.GetClientByUUID(p.NodeUUID)
	if err != nil {
		return nil, virtualnetError(err)
	}
	// Re-fetch at submission. Freeze this validated release in the transaction;
	// rollback must not depend on the network/feed remaining available.
	releases, _, err := releasefeed.Fetch(ctx, "node", true)
	if err != nil {
		return nil, virtualnetError(err)
	}
	var release virtualnet.NodeRelease
	for _, candidate := range releases {
		if candidate.Version == in.Version && candidate.Image == in.Image && candidate.Compatible(node.Version, utils.CurrentVersion, "linux/amd64") {
			release = candidate
			break
		}
	}
	if release.Image == "" {
		return nil, virtualnetError(errors.New("target is not a compatible approved ENB Node release"))
	}
	// Existing policy format uses the Docker Hub short repository name.
	policyImage := strings.TrimPrefix(release.Image, "docker.io/")
	previous, online := agent_runtime.ActiveConnectionID(p.NodeUUID)
	if !online {
		return nil, virtualnetError(errors.New("Node must be online before update"))
	}
	result, err := authorizeVirtualnetHost(ctx, in.virtualnetHostAuth)
	if err != nil {
		return nil, virtualnetError(err)
	}
	var active int64
	if err := db.Model(&virtualnet.Job{}).Where("peer_id = ? AND status IN ?", p.PeerID, []string{"running", "rollback_failed"}).Count(&active).Error; err != nil || active != 0 {
		result["error"] = "unfinished task requires inspection before another update"
		return result, nil
	}
	id := strings.ReplaceAll(uuid.NewString(), "-", "")
	job := virtualnet.Job{ID: id, PeerID: p.PeerID, NodeUUID: p.NodeUUID, Status: "running", Stage: "node_update_preflight"}
	if err := db.Create(&job).Error; err != nil {
		result["error"] = "could not persist Node update task"
		return result, nil
	}
	oldVersion, oldPermissions, oldRemote := node.Version, node.RemotePermissions, node.RemoteControlEnabled
	virtualnetAudit(ctx, "upgrade managed Node to "+release.Version, p.PeerID)
	locked = false
	go func() {
		defer virtualnetDeployment.Unlock()
		operation, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		update := func(status, stage, message string) error {
			return virtualnet.UpdateJob(db, id, p.NodeUUID, status, stage, message)
		}
		started := time.Now().UTC()
		err := virtualnet.NodeUpdate(operation, p, release, id, "prepare")
		if err == nil {
			err = update("running", "node_update_awaiting_agent", "")
		}
		if err == nil {
			verify, done := context.WithTimeout(operation, 90*time.Second)
			err = waitNodeUpdate(verify, p.NodeUUID, previous, started, release.Version, oldPermissions, oldRemote)
			done()
		}
		if err == nil {
			err = virtualnet.NodeUpdate(operation, p, release, id, "commit")
		}
		if err == nil {
			// Preserve every permission; only record the successfully verified image.
			if e := db.Model(&virtualnet.Policy{}).Where("peer_id = ?", p.PeerID).Updates(map[string]any{"node_image": policyImage, "revision": policy.Revision + 1}).Error; e != nil {
				_ = update("failed", "node_update_state", "Node upgraded but policy image state could not be saved; inspect before changing permissions")
				return
			}
			_ = update("succeeded", "node_update_complete", "Agent version and unchanged permissions verified; proxy connectivity not independently tested")
			return
		}
		_ = update("running", "node_update_rollback", "Upgrade not confirmed; attempting previous image and snapshot")
		rollback, done := context.WithTimeout(context.Background(), 3*time.Minute)
		defer done()
		before, _ := agent_runtime.ActiveConnectionID(p.NodeUUID)
		after := time.Now().UTC()
		if e := virtualnet.NodeUpdate(rollback, p, release, id, "rollback"); e != nil {
			_ = update("rollback_failed", "node_update_manual_recovery", "SSH rollback failed; installation/transaction backups retained; host inspection required")
			return
		}
		// A preflight failure may leave the original connection untouched.
		connection, stillOnline := agent_runtime.ActiveConnectionID(p.NodeUUID)
		if !(stillOnline && connection == previous) {
			if e := waitNodeUpdate(rollback, p.NodeUUID, before, after, oldVersion, oldPermissions, oldRemote); e != nil {
				_ = update("rollback_failed", "node_update_manual_recovery", "Old Agent reconnect not confirmed; inspect remote transaction")
				return
			}
		}
		if e := virtualnet.NodeUpdate(rollback, p, release, id, "finish_rollback"); e != nil {
			_ = update("rollback_failed", "node_update_manual_recovery", "Could not finalize rollback marker")
			return
		}
		_ = update("rolled_back", "node_update_rolled_back", "Upgrade not applied; old Agent and permissions verified; inspect retained backup before retry")
	}()
	result["job"] = job
	return result, nil
}

func waitNodeUpdate(ctx context.Context, id string, previous int64, after time.Time, version, permissions string, remote bool) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		node, err := clients.GetClientByUUID(id)
		connection, online := agent_runtime.ActiveConnectionID(id)
		if err == nil && online && connection != previous && node.UpdatedAt.After(after) && node.Version == version && node.RemotePermissions == permissions && node.RemoteControlEnabled == remote {
			return nil
		}
		select {
		case <-ctx.Done():
			return errors.New("new Agent version/permissions not confirmed")
		case <-ticker.C:
		}
	}
}
