package jsonrpc

import (
	"context"
	"errors"
	"time"

	"github.com/nuomiiiii/lite/database/accounts"
	"github.com/nuomiiiii/lite/database/clients"
	"github.com/nuomiiiii/lite/database/dbcore"
	"github.com/nuomiiiii/lite/pkg/rpc"
	"github.com/nuomiiiii/lite/virtualnet"
	agent_runtime "github.com/nuomiiiii/lite/web/agent"
	"github.com/nuomiiiii/lite/web/api/remote"
	"github.com/nuomiiiii/lite/web/hostctl"
	"github.com/nuomiiiii/lite/web/remotectl"
)

func init() {
	reg("virtualnet.permissions", virtualnetPermissions, "Read explicit Node/host feature permissions and reported Agent state")
	reg("virtualnet.permissions.save", virtualnetPermissionsSave, "Apply explicit feature permissions through pinned SSH")
	reg("virtualnet.host", virtualnetHost, "Run a policy-authorized host operation through pinned SSH")
	reg("virtualnet.host.terminal", virtualnetHostTerminal, "Issue a single-use, login-bound SSH terminal ticket")
}

type virtualnetHostAuth struct {
	Grant  string `json:"grant"`
	PageID string `json:"page_id"`
}

func authorizeVirtualnetHost(ctx context.Context, a virtualnetHostAuth) (map[string]any, error) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, errors.New(e.Message)
	}
	if !remote.RemoteManagementEnabled() {
		return nil, errors.New("站点未启用远程管理")
	}
	m := rpc.MetaFromContext(ctx)
	grant, expires, err := remotectl.ConsumeAndRotateGrant(a.Grant, m.Principal.UserUUID, m.SessionToken, remotectl.ScopeRemote, a.PageID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"next_grant": grant, "grant_expires": expires}, nil
}

func virtualnetPermissions(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	p, err := loadVirtualnetProfile(ctx, req)
	if err != nil {
		return nil, virtualnetError(err)
	}
	policy, err := virtualnet.LoadPolicy(dbcore.GetDBInstance(), p.PeerID)
	if err != nil {
		return nil, virtualnetError(errors.New("could not read permissions"))
	}
	result := map[string]any{"policy": policy, "node_associated": p.NodeUUID != ""}
	if p.NodeUUID != "" {
		if node, err := clients.GetClientByUUID(p.NodeUUID); err == nil {
			result["agent"] = map[string]any{"remote_control_enabled": node.RemoteControlEnabled, "remote_permissions": node.RemotePermissions, "updated_at": node.UpdatedAt}
		}
	}
	return result, nil
}

func virtualnetPermissionsSave(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var in struct {
		virtualnet.PolicyInput
		virtualnetHostAuth
		ApplyNode bool `json:"apply_node"`
		Confirmed bool `json:"confirmed"`
	}
	if err := req.BindParams(&in); err != nil {
		return nil, virtualnetError(errors.New("invalid permission request"))
	}
	if !in.Confirmed {
		return nil, virtualnetError(errors.New("explicit permission change confirmation required"))
	}
	if err := in.PolicyInput.Validate(); err != nil {
		return nil, virtualnetError(err)
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is in progress"))
	}
	defer virtualnetDeployment.Unlock()
	p, err := loadVirtualnetProfile(ctx, req)
	if err != nil {
		return nil, virtualnetError(err)
	}
	db := dbcore.GetDBInstance()
	old, err := virtualnet.LoadPolicy(db, p.PeerID)
	if err != nil {
		return nil, virtualnetError(err)
	}
	if old.Revision != in.Revision {
		return nil, virtualnetError(errors.New("permissions changed; reload before saving"))
	}
	changed := old.NodeAllowlist() != in.NodeAllowlist() || old.NodeImage != in.NodeImage
	if changed && !in.ApplyNode {
		return nil, virtualnetError(errors.New("Node permission changes require SSH apply"))
	}
	if in.ApplyNode && (p.NodeUUID == "" || p.Paused) {
		return nil, virtualnetError(errors.New("an associated running managed Node is required"))
	}
	meta := rpc.MetaFromContext(ctx)
	epoch := accounts.UserSecurityEpoch(meta.Principal.UserUUID)
	result, err := authorizeVirtualnetHost(ctx, in.virtualnetHostAuth)
	if err != nil {
		return nil, virtualnetError(err)
	}
	// Revoke old host access before SSH; failures must not grant new permissions.
	virtualnetAudit(ctx, "confirm explicit Node and host permission change", p.PeerID)
	closed := old
	closed.HostTerminal = false
	closed.HostFiles = false
	closed.HostExec = false
	closed.NodeDocker = false
	closed.Projects = nil
	if err = virtualnet.SavePolicy(db, closed); err != nil {
		result["error"] = "could not suspend previous permissions"
		return result, nil
	}
	hostctl.ClosePeer(p.PeerID)
	// Host grants also require a successful pinned SSH connection, even when no
	// Node container is installed. No host account settings are changed.
	verifyCtx, verifyCancel := context.WithTimeout(ctx, 20*time.Second)
	connection, verifyErr := virtualnet.ConnectHost(verifyCtx, p)
	verifyCancel()
	if verifyErr != nil {
		result["error"] = verifyErr.Error()
		return result, nil
	}
	connection.Close()
	if in.ApplyNode {
		operationCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		appliedAfter := time.Now().UTC()
		previousConnection, _ := agent_runtime.ActiveConnectionID(p.NodeUUID)
		err = virtualnet.ApplyNodePermissions(operationCtx, p, in.Policy)
		if err == nil {
			// Container-running is not proof: require the Agent's exact allowlist.
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for {
				node, e := clients.GetClientByUUID(p.NodeUUID)
				connection, online := agent_runtime.ActiveConnectionID(p.NodeUUID)
				if e == nil && online && connection != previousConnection && node.UpdatedAt.After(appliedAfter) && node.RemotePermissions == in.NodeAllowlist() && node.RemoteControlEnabled == (in.NodeAllowlist() != "none") {
					break
				}
				select {
				case <-operationCtx.Done():
					err = errors.New("Node permissions not confirmed by Agent; inspect remote installation before retrying")
				case <-ticker.C:
				}
				if err != nil {
					break
				}
			}
		}
		if err != nil {
			result["error"] = err.Error()
			return result, nil
		}
	}
	if !remote.RemoteManagementEnabled() || accounts.UserSecurityEpoch(meta.Principal.UserUUID) != epoch || !accounts.SessionStillValid(meta.Principal.UserUUID, meta.SessionToken) {
		result["error"] = "authorization revoked during permission apply; host access remains disabled"
		return result, nil
	}
	in.Revision = closed.Revision + 1
	if err = virtualnet.SavePolicy(db, in.PolicyInput); err != nil {
		result["error"] = "remote configuration may have changed but permission state could not be saved"
		return result, nil
	}
	virtualnetAudit(ctx, "save explicit Node and host permissions", p.PeerID)
	result["saved"] = true
	return result, nil
}

func virtualnetHost(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var in struct {
		virtualnet.HostRequest
		virtualnetHostAuth
	}
	if err := req.BindParams(&in); err != nil {
		return nil, virtualnetError(errors.New("invalid host request"))
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is in progress"))
	}
	defer virtualnetDeployment.Unlock()
	p, err := loadVirtualnetProfile(ctx, req)
	if err != nil {
		return nil, virtualnetError(err)
	}
	policy, err := virtualnet.LoadPolicy(dbcore.GetDBInstance(), p.PeerID)
	if err != nil {
		return nil, virtualnetError(err)
	}
	meta := rpc.MetaFromContext(ctx)
	epoch := accounts.UserSecurityEpoch(meta.Principal.UserUUID)
	result, err := authorizeVirtualnetHost(ctx, in.virtualnetHostAuth)
	if err != nil {
		return nil, virtualnetError(err)
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	watchDone := make(chan struct{})
	defer close(watchDone)
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-watchDone:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !remote.RemoteManagementEnabled() || accounts.UserSecurityEpoch(meta.Principal.UserUUID) != epoch || !accounts.SessionStillValid(meta.Principal.UserUUID, meta.SessionToken) {
					cancel()
					return
				}
			}
		}
	}()
	virtualnetAudit(ctx, "authorized host operation", p.PeerID) // Never log user-supplied commands/file contents.
	value, err := virtualnet.HostOperation(ctx, p, policy, in.HostRequest)
	if err != nil {
		result["error"] = err.Error()
	} else {
		result["result"] = value
	}
	return result, nil
}

func virtualnetHostTerminal(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var in virtualnetHostAuth
	if err := req.BindParams(&in); err != nil {
		return nil, virtualnetError(errors.New("invalid request"))
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is in progress"))
	}
	defer virtualnetDeployment.Unlock()
	p, err := loadVirtualnetProfile(ctx, req)
	if err != nil {
		return nil, virtualnetError(err)
	}
	policy, err := virtualnet.LoadPolicy(dbcore.GetDBInstance(), p.PeerID)
	if err != nil {
		return nil, virtualnetError(err)
	}
	if !policy.HostTerminal {
		return nil, virtualnetError(errors.New("host terminal permission is disabled"))
	}
	m := rpc.MetaFromContext(ctx)
	epoch := accounts.UserSecurityEpoch(m.Principal.UserUUID)
	result, err := authorizeVirtualnetHost(ctx, in)
	if err != nil {
		return nil, virtualnetError(err)
	}
	ticket, err := hostctl.IssueAtEpoch(p, policy.Revision, m.Principal.UserUUID, m.SessionToken, epoch)
	if err != nil {
		result["error"] = err.Error()
	} else {
		result["ticket"] = ticket
	}
	virtualnetAudit(ctx, "request host SSH terminal", p.PeerID)
	return result, nil
}
