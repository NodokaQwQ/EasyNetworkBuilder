package cmd

import (
	pkg_flags "github.com/nuomiiiii/lite-agent/cmd/flags"
	"os"
	"path/filepath"
	"testing"
)

func TestRemotePermissionsConfigPrecedence(t *testing.T) {
	t.Setenv("AGENT_REMOTE_CONTROL_ENABLED", "")
	t.Setenv("AGENT_DISABLE_WEB_SSH", "")
	for _, test := range []struct {
		name, env string
		args      []string
		want      string
	}{
		{"json", "", nil, "files"}, {"env", "exec", nil, "exec"}, {"cli", "exec", []string{"--remote-permissions=terminal"}, "terminal"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("AGENT_REMOTE_PERMISSIONS", test.env)
			file := filepath.Join(t.TempDir(), "config.json")
			if err := os.WriteFile(file, []byte(`{"remote_control_enabled":true,"remote_permissions":"files"}`), 0600); err != nil {
				t.Fatal(err)
			}
			config := &pkg_flags.Config{ConfigFile: file}
			command := remoteControlTestCommand(config)
			if err := command.ParseFlags(test.args); err != nil {
				t.Fatal(err)
			}
			if err := loadEffectiveConfig(command, config); err != nil {
				t.Fatal(err)
			}
			if config.RemotePermissions != test.want {
				t.Fatalf("%s got %s", test.name, config.RemotePermissions)
			}
		})
	}
}
