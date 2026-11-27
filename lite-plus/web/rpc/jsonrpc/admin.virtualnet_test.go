package jsonrpc

import (
	"context"
	"testing"

	"github.com/nuomiiiii/lite/pkg/rpc"
)

func TestVirtualNetworkRequiresHumanSession(t *testing.T) {
	for name, handler := range map[string]rpc.Handler{
		"discover": virtualnetDiscover, "fingerprint": virtualnetFingerprint,
		"profiles": virtualnetProfiles, "save": virtualnetSave, "delete": virtualnetDelete,
		"test": virtualnetTest, "deploy": virtualnetDeploy, "jobs": virtualnetJobs,
		"settings": virtualnetSettings, "settings.save": virtualnetSettingsSave,
		"inspect": virtualnetInspection,
		"pause":   virtualnetPause, "resume": virtualnetResume,
		"permissions": virtualnetPermissions, "permissions.save": virtualnetPermissionsSave,
		"host": virtualnetHost, "host.terminal": virtualnetHostTerminal,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := handler(context.Background(), &rpc.JsonRpcRequest{}); err == nil {
				t.Fatal("request without administrator session accepted")
			}
			ctx := rpc.NewContextWithMeta(context.Background(), &rpc.ContextMeta{Principal: rpc.NewAPIKeyPrincipal(), SessionToken: "not-a-human"})
			if _, err := handler(ctx, &rpc.JsonRpcRequest{}); err == nil {
				t.Fatal("API key accepted")
			}
		})
	}
}
