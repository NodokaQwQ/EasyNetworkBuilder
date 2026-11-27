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
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := handler(context.Background(), &rpc.JsonRpcRequest{}); err == nil {
				t.Fatal("request without administrator session accepted")
			}
		})
	}
}
