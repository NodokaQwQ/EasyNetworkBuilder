package server

import (
	pkg_flags "github.com/nuomiiiii/lite-agent/cmd/flags"
	v2 "github.com/nuomiiiii/lite-agent/protocol/v2"
	"testing"
)

func TestCapabilitiesRespectIndependentRemotePermissions(t *testing.T) {
	old := pkg_flags.GlobalConfig
	defer func() { pkg_flags.GlobalConfig = old }()
	for _, allow := range []string{"terminal", "mcp", "firewall", "protection", "none"} {
		pkg_flags.GlobalConfig = &pkg_flags.Config{RemoteControlEnabled: true, RemotePermissions: allow}
		caps, _ := currentV2PullCapabilities()
		found := map[string]bool{}
		for _, cap := range caps {
			found[cap] = true
		}
		for permission, cap := range map[string]string{"mcp": v2.CapabilityMCPFull, "firewall": v2.CapabilityFirewall, "protection": v2.CapabilityServiceProtection} {
			if found[cap] != (permission == allow) {
				t.Fatalf("%s advertised %s: %v", allow, cap, caps)
			}
		}
	}
}
