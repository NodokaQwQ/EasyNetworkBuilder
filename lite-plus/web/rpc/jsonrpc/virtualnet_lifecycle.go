package jsonrpc

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/nuomiiiii/lite/database/clients"
	"github.com/nuomiiiii/lite/database/dbcore"
	"github.com/nuomiiiii/lite/pkg/rpc"
	logger "github.com/nuomiiiii/lite/utils/log"
	"github.com/nuomiiiii/lite/virtualnet"
	agent_runtime "github.com/nuomiiiii/lite/web/agent"
)

func virtualnetPause(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	return virtualnetLifecycle(ctx, req, false)
}
func virtualnetResume(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	return virtualnetLifecycle(ctx, req, true)
}

func virtualnetLifecycle(ctx context.Context, req *rpc.JsonRpcRequest, resume bool) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	var options struct {
		ConfirmationToken string `json:"confirmation_token"`
	}
	if e := req.BindParams(&options); e != nil {
		return nil, virtualnetError(errors.New("invalid request"))
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is in progress"))
	}
	accepted := false
	defer func() {
		if !accepted {
			virtualnetDeployment.Unlock()
		}
	}()
	p, e := loadVirtualnetProfile(ctx, req)
	if e != nil {
		return nil, virtualnetError(e)
	}
	db := dbcore.GetDBInstance()
	s, e := virtualnet.LoadSettings(db)
	if e != nil {
		return nil, virtualnetError(e)
	}
	action := "pause"
	if resume {
		action = "resume"
	}
	if e = consumeVirtualnetActionConfirmation(ctx, options.ConfirmationToken, p, s, false, action); e != nil {
		return nil, virtualnetError(e)
	}
	if resume {
		if p.NodeUUID == "" {
			return nil, virtualnetError(errors.New("Node panel association was deleted; restore requires the original server record"))
		}
		if _, e = clients.GetClientByUUID(p.NodeUUID); e != nil {
			return nil, virtualnetError(errors.New("original Node panel record not found; cannot reuse its token"))
		}
	}
	job := virtualnet.Job{ID: uuid.NewString(), PeerID: p.PeerID, NodeUUID: p.NodeUUID, Status: "running", Stage: action}
	if e = db.Create(&job).Error; e != nil {
		return nil, virtualnetError(errors.New("could not create lifecycle job"))
	}
	virtualnetAudit(ctx, action+" managed Node (preserve data)", p.PeerID)
	accepted = true
	go func() {
		defer virtualnetDeployment.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		update := func(status, stage, message string) bool {
			if e := virtualnet.UpdateJob(db, job.ID, p.NodeUUID, status, stage, message); e != nil {
				logger.Errorf("virtualnet", "Lifecycle %s: status persistence failed at %s", job.ID, stage)
				return false
			}
			return true
		}
		previousConnection, wasOnline := agent_runtime.ActiveConnectionID(p.NodeUUID)
		if e := virtualnet.Lifecycle(ctx, p, resume); e != nil {
			update("failed", action, e.Error()+"; installation files are preserved")
			return
		}
		if e := db.Model(&virtualnet.Profile{}).Where("peer_id = ?", p.PeerID).Update("paused", !resume).Error; e != nil {
			update("failed", action, "remote operation completed but deployment state could not be saved")
			return
		}
		if !resume {
			if p.NodeUUID != "" {
				agent_runtime.DeleteConnectedClients(p.NodeUUID)
			}
			update("succeeded", "paused", "")
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
				update("failed", "awaiting_agent", "Compose started but retained Agent did not reconnect; check its saved control URL and token")
				return
			case <-ticker.C:
				connection, online := agent_runtime.ActiveConnectionID(p.NodeUUID)
				if online && (!wasOnline || !p.Paused || connection != previousConnection) {
					update("succeeded", "online", "")
					return
				}
			}
		}
	}()
	return job, nil
}
