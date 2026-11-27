package jsonrpc

import (
	"context"
	"github.com/nuomiiiii/lite/pkg/rpc"
	"testing"
)

func TestNodeUpgradeRequiresAdminAndRejectsAPIKey(t *testing.T) {
	for _, method := range []string{"admin:virtualnet.node.releases", "admin:virtualnet.node.update"} {
		if rpc.CheckPrincipal(rpc.PrincipalFromRole(rpc.RoleGuest), method) {
			t.Fatal("guest allowed", method)
		}
		if !rpc.CheckPrincipal(rpc.PrincipalFromRole(rpc.RoleAdmin), method) {
			t.Fatal("admin denied", method)
		}
	}
	ctx := rpc.NewContextWithMeta(context.Background(), &rpc.ContextMeta{Principal: rpc.NewAPIKeyPrincipal(), Permission: rpc.RoleAdmin})
	for _, handler := range []func(context.Context, *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError){virtualnetNodeReleases, virtualnetNodeUpdate} {
		_, err := handler(ctx, &rpc.JsonRpcRequest{})
		if err == nil || err.Code != rpc.PermissionDenied {
			t.Fatal("API key not rejected", err)
		}
	}
}

func TestNodeUpgradeRequiresExplicitConfirmation(t *testing.T) {
	_, err := virtualnetNodeUpdate(context.Background(), &rpc.JsonRpcRequest{Params: map[string]any{"confirmed": false}})
	if err == nil {
		t.Fatal("accepted unconfirmed upgrade")
	}
}
