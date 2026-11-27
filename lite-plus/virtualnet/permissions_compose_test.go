package virtualnet

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Isolated config-only validation on real Docker Compose. No real tokens,
// servers, host networking or privileged container are involved.
func TestPermissionOverrideRealCompose(t *testing.T) {
	if os.Getenv("ENB_PERMISSIONS_COMPOSE_TEST") != "1" {
		t.Skip("requires Docker Compose")
	}
	dir := t.TempDir()
	base, err := Compose("isolated-placeholder", Settings{ControlURL: "https://head.example.test"})
	if err != nil {
		t.Fatal(err)
	}
	base = strings.Replace(base, "    network_mode: host\n", "", 1)
	if err = os.WriteFile(filepath.Join(dir, "compose.yaml"), []byte(base), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, ".env"), []byte("ENB_HOST_NICS=fixture0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, permissions := range []string{"none", "terminal", "files", "terminal,files,exec,mcp"} {
		override := "services:\n  node:\n    command: [\"--disable-auto-update\",\"--enable-remote-control=true\",\"--remote-permissions=" + permissions + "\"]\n"
		if err = os.WriteFile(filepath.Join(dir, "permissions.yaml"), []byte(override), 0600); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command("docker", "compose", "-p", "enb-permission-config-test", "-f", filepath.Join(dir, "compose.yaml"), "-f", filepath.Join(dir, "permissions.yaml"), "config", "--format", "json")
		b, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		// Exercise the exact command guard against real Compose JSON, including
		// its trailing comma before other service fields.
		guard := exec.Command("awk", `{config=config $0} END {gsub(/[[:space:]]/, "", config); if (config !~ /"command":\["--disable-auto-update"\]/) exit 1}`)
		baseCmd := exec.Command("docker", "compose", "-f", filepath.Join(dir, "compose.yaml"), "config", "--format", "json")
		baseJSON, err := baseCmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		guard.Stdin = strings.NewReader(string(baseJSON))
		if err = guard.Run(); err != nil {
			t.Fatal("base command guard rejected real Compose JSON", err)
		}
		var config struct {
			Services map[string]struct {
				Image       string            `json:"image"`
				Command     []string          `json:"command"`
				Environment map[string]string `json:"environment"`
				Volumes     []struct {
					Target string `json:"target"`
				} `json:"volumes"`
			} `json:"services"`
		}
		if err = json.Unmarshal(b, &config); err != nil {
			t.Fatal(err)
		}
		node := config.Services["node"]
		if len(config.Services) != 1 || node.Image != NodeImage || len(node.Command) != 3 || node.Command[2] != "--remote-permissions="+permissions || node.Environment["AGENT_TOKEN"] != "isolated-placeholder" || len(node.Volumes) != 1 || node.Volumes[0].Target != "/app/nodemgt" {
			t.Fatal("permission override changed retained fields")
		}
	}
}

// Validate command safety against both supported Compose JSON layouts.
func TestPermissionCommandGuardRejectsExtraArgs(t *testing.T) {
	for _, test := range []struct {
		json string
		ok   bool
	}{
		{`{"command":["--disable-auto-update"]}`, true},
		{"{\n\"command\": [\n\"--disable-auto-update\"\n],\n\"image\":\"fixture\"\n}", true},
		{`{"command":["--disable-auto-update","--endpoint=other"]}`, false},
		{`{"command":["--enable-remote-control"]}`, false},
	} {
		cmd := exec.Command("awk", `{config=config $0} END {gsub(/[[:space:]]/, "", config); if (config !~ /"command":\["--disable-auto-update"\]/) exit 1}`)
		cmd.Stdin = strings.NewReader(test.json)
		if (cmd.Run() == nil) != test.ok {
			t.Fatalf("unexpected guard result: %s", test.json)
		}
	}
}
