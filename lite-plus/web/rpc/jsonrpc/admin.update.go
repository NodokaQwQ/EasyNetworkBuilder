package jsonrpc

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/nuomiiiii/lite/cmd/flags"
	"github.com/nuomiiiii/lite/database/auditlog"
	"github.com/nuomiiiii/lite/database/metricstore"
	"github.com/nuomiiiii/lite/pkg/config"
	"github.com/nuomiiiii/lite/pkg/dockerupdate"
	"github.com/nuomiiiii/lite/pkg/metric"
	"github.com/nuomiiiii/lite/pkg/releasefeed"
	"github.com/nuomiiiii/lite/pkg/rpc"
	"github.com/nuomiiiii/lite/pkg/selfupdate"
	"github.com/nuomiiiii/lite/utils"
)

func init() {
	RegisterWithGroupAndMeta("getENBReleases", rpc.RoleAdmin, adminGetENBReleases, &rpc.MethodMeta{
		Name: "admin:getENBReleases", Summary: "Read approved ENB Docker releases from the host updater",
	})
	RegisterWithGroupAndMeta("getSelfUpdateStatus", rpc.RoleAdmin, adminGetSelfUpdateStatus, &rpc.MethodMeta{
		Name:    "admin:getSelfUpdateStatus",
		Summary: "Return ENB Docker update capability and the persistent task result",
		Returns: "SelfUpdateCapability",
	})
	RegisterWithGroupAndMeta("startSelfUpdate", rpc.RoleAdmin, adminStartSelfUpdate, &rpc.MethodMeta{
		Name:    "admin:startSelfUpdate",
		Summary: "Submit an approved ENB Head image update to the host updater",
		Params: []rpc.ParamMeta{
			{Name: "version", Type: "string", Required: true},
			{Name: "version_hash", Type: "string", Required: true},
		},
		Returns: "SelfUpdateResult",
	})
}

func adminGetSelfUpdateStatus(ctx context.Context, _ *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	status := map[string]any{"deployment": selfupdate.DeploymentType(), "supported": false, "reason": "enb_host_updater_not_configured"}
	if selfupdate.DeploymentType() != selfupdate.DeploymentDocker {
		return status, nil
	}
	if err := dockerupdate.Call(ctx, "GET", "/status", nil, &status); err != nil {
		return status, nil
	}
	if status["supported"] == true {
		delete(status, "reason")
	}
	if !enbLocalDataSupported() {
		status["supported"] = false
		status["reason"] = "unsupported_database_layout"
	}
	return status, nil
}

func enbLocalDataSupported() bool {
	settings, err := config.GetManyAs[metricstore.MetricStoreConfig]()
	workingDir, wdErr := os.Getwd()
	return err == nil && wdErr == nil && metricstore.ResolveDriverFromConfig(settings.Driver, settings.DSN) == metric.DriverSQLite &&
		selfupdate.PathWithinData(settings.DSN, filepath.Join(workingDir, "data"), workingDir) && flags.IsSQLite() &&
		selfupdate.PathWithinData(flags.DatabaseFile, filepath.Join(workingDir, "data"), workingDir)
}

func adminGetENBReleases(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	var options struct {
		Force bool `json:"force"`
	}
	if req != nil {
		if err := req.BindParams(&options); err != nil {
			return nil, rpc.MakeError(rpc.InvalidParams, "invalid release check request", nil)
		}
	}
	releases, checked, err := releasefeed.Fetch(ctx, "head", options.Force)
	result := map[string]any{"releases": []releasefeed.Release{}, "checked_at": checked}
	if err != nil {
		result["check_error"] = err.Error()
		return result, nil
	}
	// Host validates again before stopping anything; hide incompatible releases.
	compatible := []releasefeed.Release{}
	for _, release := range releases {
		if release.Compatible(utils.CurrentVersion, utils.CurrentVersion, "linux/amd64") {
			compatible = append(compatible, release)
		}
	}
	result["releases"] = compatible
	return result, nil
}

func adminStartSelfUpdate(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if err := denyAPIKey(ctx); err != nil {
		return nil, err
	}
	var params struct {
		Version     string `json:"version"`
		VersionHash string `json:"version_hash"`
	}
	if err := req.BindParams(&params); err != nil {
		return nil, rpc.MakeError(rpc.InvalidParams, "Invalid update request: "+err.Error(), nil)
	}
	if selfupdate.DeploymentType() != selfupdate.DeploymentDocker || !enbLocalDataSupported() {
		return nil, rpc.MakeError(rpc.InvalidParams, "ENB Docker update requires a supported local SQLite data layout", nil)
	}
	updateCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var result map[string]any
	if err := dockerupdate.Call(updateCtx, "POST", "/start", params, &result); err != nil {
		return nil, rpc.MakeError(rpc.InternalError, "Failed to prepare update: "+err.Error(), nil)
	}
	actor, ip := auditActor(ctx)
	auditlog.Event(ip, actor, "warn", "audit.self_update", map[string]string{"version": params.Version, "hash": params.VersionHash})
	return result, nil
}
