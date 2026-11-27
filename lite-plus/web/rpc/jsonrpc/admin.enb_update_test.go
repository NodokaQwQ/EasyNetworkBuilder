package jsonrpc

import (
	"context"
	"testing"

	"github.com/nuomiiiii/lite/pkg/rpc"
)

func TestENBUpdateMethodsRequireAdministrator(t *testing.T) {
	for _, method := range []string{"admin:getENBReleases", "admin:getSelfUpdateStatus", "admin:startSelfUpdate"} {
		if rpc.CheckPrincipal(rpc.PrincipalFromRole(rpc.RoleGuest), method) {
			t.Fatalf("guest allowed %s", method)
		}
		if !rpc.CheckPrincipal(rpc.PrincipalFromRole(rpc.RoleAdmin), method) {
			t.Fatalf("admin denied %s", method)
		}
	}
}

func TestENBUpdateWithoutHostUpdaterIsUnavailable(t *testing.T) {
	t.Setenv("LITE_DEPLOYMENT", "docker")
	t.Setenv("ENB_UPDATER_SOCKET", "")
	value, rpcErr := adminGetSelfUpdateStatus(context.Background(), nil)
	if rpcErr != nil {
		t.Fatal(rpcErr)
	}
	status := value.(map[string]any)
	if status["supported"] != false || status["deployment"] != "docker" {
		t.Fatal(status)
	}
}

func TestENBBinaryDeploymentCannotUseUpstreamUpdate(t *testing.T) {
	t.Setenv("LITE_DEPLOYMENT", "linux")
	value, rpcErr := adminGetSelfUpdateStatus(context.Background(), nil)
	if rpcErr != nil || value.(map[string]any)["supported"] != false {
		t.Fatalf("%v %v", value, rpcErr)
	}
}
