package virtualnet

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestNodeReleaseAllowlist(t *testing.T) {
	invalid := testNodeRelease()
	invalid.Image = "nodokaqwq/enb:node-latest"
	if err := invalid.Validate("node"); err == nil {
		t.Fatal("accepted mutable image")
	}
	if _, err := nodeUpdateScript(testNodeRelease(), "../escape", "prepare"); err == nil {
		t.Fatal("accepted invalid transaction")
	}
	if _, err := nodeUpdateScript(testNodeRelease(), strings.Repeat("a", 32), "delete"); err == nil {
		t.Fatal("accepted arbitrary action")
	}
}

func TestComposeSelectedRelease(t *testing.T) {
	release := testNodeRelease()
	release.Image = "docker.io/nodokaqwq/enb@sha256:" + strings.Repeat("b", 64)
	compose, err := ComposeRelease("isolated-token", Settings{ControlURL: "https://head.example.test"}, release)
	if err != nil || !strings.Contains(compose, "image: "+release.Image) || strings.Contains(compose, "image: "+NodeImage) {
		t.Fatalf("selected digest not used: %s %v", compose, err)
	}
	release.Image = "docker.io/nodokaqwq/enb:node-latest"
	if _, err := ComposeRelease("isolated-token", Settings{ControlURL: "https://head.example.test"}, release); err == nil {
		t.Fatal("accepted unpinned release")
	}
}

func testNodeRelease() NodeRelease {
	return NodeRelease{Version: "0.0.1", Hash: "abcdef123", Image: "docker.io/" + NodeImage, Platform: "linux/amd64", Channel: "stable", Rollback: "restore-nodemgt-v1", MinHead: "0.0.1", FromVersions: []string{"0.2.1-enb-test"}, PublishedAt: "2026-11-27T00:00:00Z"}
}

func TestNodeUpgradeScriptsPreserveAndRollback(t *testing.T) {
	for _, mode := range []string{"success", "pull-failed", "symlink", "extra-mount", "active"} {
		t.Run(mode, func(t *testing.T) {
			home := t.TempDir()
			home, _ = filepath.EvalSymlinks(home)
			target := filepath.Join(home, "enb", "node")
			if err := os.MkdirAll(filepath.Join(target, "nodemgt"), 0700); err != nil {
				t.Fatal(err)
			}
			for name, value := range map[string]string{"compose.yaml": "original token", ".env": "original env", "permissions.yaml": "original permissions", "nodemgt/state": "old snapshot"} {
				if err := os.WriteFile(filepath.Join(target, name), []byte(value), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "symlink" {
				_ = os.Symlink("/etc/passwd", filepath.Join(target, "nodemgt", "link"))
			}
			if mode == "active" {
				_ = os.WriteFile(filepath.Join(target, ".enb-update-active"), []byte("other"), 0600)
			}
			bin := filepath.Join(home, "bin")
			_ = os.Mkdir(bin, 0700)
			fake := `#!/bin/sh
case "$*" in
*"ps -aq"*) ;;
*"ps -a --format"*) echo 'enb-managed-node-node-1 enb-managed-node';;
*"config --services"*) echo node;;
*"config --images"*) echo '` + NodeImage + `';;
*"ps --status running"*) if [ ! -f "$TEST_HOME/stopped" ]; then echo container-id; fi;;
"inspect -f {{.Image}}"*) echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;;
"inspect -f {{.State.Running}}"*) echo false;;
"inspect -f {{range .Mounts}}"*) if [ "$TEST_MODE" = extra-mount ]; then echo extra; else echo "bind $TEST_HOME/enb/node/nodemgt /app/nodemgt"; fi;;
"pull"*) if [ "$TEST_MODE" = pull-failed ]; then exit 1; fi;;
"image inspect -f {{.Os}}/{{.Architecture}}"*) echo linux/amd64;;
"image inspect -f {{.Id}}"*) echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;;
"run"*) echo --remote-permissions;;
*"stop -t 30 node"*) touch "$TEST_HOME/stopped";;
*"up -d"*) rm -f "$TEST_HOME/stopped"; echo new > nodemgt/state; echo up >> "$TEST_HOME/log";;
esac
`
			for name, body := range map[string]string{"docker": fake, "sync": "#!/bin/sh\nexit 0\n", "uname": "#!/bin/sh\necho x86_64\n"} {
				_ = os.WriteFile(filepath.Join(bin, name), []byte(body), 0700)
			}
			runScript := func(action string) error {
				script, err := nodeUpdateScript(testNodeRelease(), strings.Repeat("a", 32), action)
				if err != nil {
					t.Fatal(err)
				}
				script = strings.ReplaceAll(script, "test ! -e /opt/enb/node\n", "")
				script = strings.ReplaceAll(script, "test ! -L /opt/enb/node\n", "")
				cmd := exec.Command("sh", "-c", script, "enb", home)
				cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "TEST_HOME="+home, "TEST_MODE="+mode)
				out, err := cmd.CombinedOutput()
				if err != nil && mode == "success" {
					t.Fatalf("%s: %v %s", action, err, out)
				}
				return err
			}
			err := runScript("prepare")
			if (err == nil) != (mode == "success") {
				t.Fatal("unexpected prepare result", err)
			}
			for name, expected := range map[string]string{"compose.yaml": "original token", ".env": "original env", "permissions.yaml": "original permissions"} {
				value, _ := os.ReadFile(filepath.Join(target, name))
				if string(value) != expected {
					t.Fatal("original changed", name)
				}
			}
			if mode == "success" {
				backup := filepath.Join(target, ".enb-update-"+strings.Repeat("a", 32))
				value, _ := os.ReadFile(filepath.Join(backup, "nodemgt/state"))
				if string(value) != "old snapshot" {
					t.Fatal("no consistent backup")
				}
				_ = runScript("rollback")
				value, _ = os.ReadFile(filepath.Join(backup, "failed-nodemgt/state"))
				if string(value) != "new\n" {
					t.Fatal("failed data not retained")
				}
				_ = runScript("finish_rollback")
				if _, err := os.Stat(filepath.Join(target, ".enb-update-active")); !os.IsNotExist(err) {
					t.Fatal("marker retained after verified rollback")
				}
			} else {
				if _, err := os.Stat(filepath.Join(home, "log")); err == nil {
					t.Fatal("recreated on failed preflight")
				}
			}
		})
	}
}
