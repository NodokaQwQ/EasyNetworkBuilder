package remote

import (
	"github.com/nuomiiiii/lite/database/models"
	"testing"
)

func TestAgentGranularPermissions(t *testing.T) {
	c := models.Client{RemoteProtocol: 2, RemoteControlEnabled: true, RemotePermissions: "terminal,files"}
	if !AgentPermissionAllowed(c, "terminal") || !AgentPermissionAllowed(c, "files") || AgentPermissionAllowed(c, "exec") || AgentPermissionAllowed(c, "mcp") {
		t.Fatal("allowlist not enforced")
	}
	c.RemotePermissions = "none"
	if AgentPermissionAllowed(c, "terminal") {
		t.Fatal("none granted")
	}
	c.RemotePermissions = ""
	if !AgentPermissionAllowed(c, "exec") {
		t.Fatal("legacy behavior lost")
	}
	c.RemoteControlEnabled = false
	if AgentPermissionAllowed(c, "terminal") {
		t.Fatal("master off bypassed")
	}
}
