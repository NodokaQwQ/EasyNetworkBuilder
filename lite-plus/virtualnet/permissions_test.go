package virtualnet

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPermissionPolicyValidationAndPersistence(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&Policy{}, &Profile{}); err != nil {
		t.Fatal(err)
	}
	p, err := LoadPolicy(db, "42")
	if err != nil || p.NodeAllowlist() != "none" || p.HostTerminal || len(p.Projects) != 0 {
		t.Fatal(p, err)
	}
	p.NodeTerminal = true
	p.HostFiles = true
	p.HostTerminal = true
	p.NodeImage = NodeImage
	p.Projects = []Project{{"test-project", "/srv/test"}}
	if err = SavePolicy(db, p); err != nil {
		t.Fatal(err)
	}
	p, err = LoadPolicy(db, "42")
	if err != nil || p.NodeAllowlist() != "terminal" || !p.HostFiles || p.Revision != 1 || len(p.Projects) != 1 {
		t.Fatal(p, err)
	}
	if err = RevokeHostPolicy(db, "42"); err != nil {
		t.Fatal(err)
	}
	p, err = LoadPolicy(db, "42")
	if err != nil || p.HostTerminal || p.HostFiles || len(p.Projects) != 0 || !p.NodeTerminal || p.Revision != 2 {
		t.Fatal(p, err)
	}
	for _, projects := range [][]Project{
		{{"enb-managed-node", "/srv/a"}}, {{"bad;name", "/srv/a"}}, {{"ok", "/"}}, {{"ok", "relative"}}, {{"ok", "/srv/../a"}}, {{"ok", "/srv/a\n"}}, {{"a", "/srv/a"}, {"a", "/srv/b"}},
	} {
		p.Projects = projects
		if p.Validate() == nil {
			t.Fatal("accepted", projects)
		}
	}
	p.Projects = nil
	p.NodeImage = "nodokaqwq/enb:latest"
	if p.Validate() == nil {
		t.Fatal("accepted mutable image")
	}
}

func TestHostOperationsDenyBeforeSSH(t *testing.T) {
	for _, r := range []HostRequest{
		{Operation: "exec", Command: "id"}, {Operation: "list", Path: "/"}, {Operation: "upload", Path: "/a"}, {Operation: "download", Path: "/a"},
		{Operation: "docker", Project: "enb-managed-node", Action: "status"}, {Operation: "docker", Project: "untrusted", Action: "restart"},
	} {
		_, err := HostOperation(context.Background(), Profile{}, PolicyInput{}, r)
		if err == nil || strings.Contains(err.Error(), "SSH") {
			t.Fatalf("not denied before connection: %+v %v", r, err)
		}
	}
}

func TestEmptyProjectPolicySerializesAsArray(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&Policy{}); err != nil {
		t.Fatal(err)
	}
	if err = SavePolicy(db, PolicyInput{Policy: Policy{PeerID: "42"}}); err != nil {
		t.Fatal(err)
	}
	p, err := LoadPolicy(db, "42")
	if err != nil || p.Projects == nil {
		t.Fatalf("empty projects must be [] not null: %+v %v", p, err)
	}
}

func TestNodePermissionScriptPreservesOriginalFilesAndRejectsOldAgent(t *testing.T) {
	for _, mode := range []string{"success", "compact-json", "legacy-image", "custom-command", "unsupported", "symlink", "extra-service", "pull-failed"} {
		t.Run(mode, func(t *testing.T) {
			home := t.TempDir()
			home, _ = filepath.EvalSymlinks(home)
			target := filepath.Join(home, "enb", "node")
			if err := os.MkdirAll(target, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(filepath.Join(target, "nodemgt"), 0700); err != nil {
				t.Fatal(err)
			}
			original := map[string]string{"compose.yaml": "original token and compose", ".env": "original environment", "permissions.yaml": "previous permission override"}
			for name, value := range original {
				if err := os.WriteFile(filepath.Join(target, name), []byte(value), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "symlink" {
				os.Remove(filepath.Join(target, "permissions.yaml"))
				os.Symlink(filepath.Join(target, ".env"), filepath.Join(target, "permissions.yaml"))
			}
			bin := filepath.Join(home, "bin")
			os.Mkdir(bin, 0700)
			fake := `#!/bin/sh
case "$*" in
 "image inspect"*) test "$TEST_MODE" != pull-failed;;
 "pull"*) exit 1;;
 "run"*) if [ "$TEST_MODE" != unsupported ]; then echo --remote-permissions; fi;;
 *"ps -aq"*|*"ps -q"*) ;;
 *"ps -a --format"*) echo 'enb-managed-node-node-1 enb-managed-node';;
 *"config --services"*) if [ "$TEST_MODE" = extra-service ]; then printf 'node\nother\n'; else echo node; fi;;
 *"config --format json"*) case "$TEST_MODE" in compact-json) echo '{"services":{"node":{"command":["--disable-auto-update"]}}}';; custom-command) echo '{"services":{"node":{"command":["--disable-auto-update","--custom"]}}}';; *) printf '{"services":{"node":{\n"command": [\n"--disable-auto-update"\n]\n}}}\n';; esac;;
 *"config --images"*) if [ "$TEST_MODE" = legacy-image ]; then echo '` + LegacyNodeImage + `'; else echo '` + NodeImage + `'; fi;;
 *"up -d"*) echo recreate >> "$TEST_LOG";;
 *"ps --status running"*) echo running;;
esac
`
			for name, script := range map[string]string{"docker": fake, "flock": "#!/bin/sh\nexit 0\n"} {
				os.WriteFile(filepath.Join(bin, name), []byte(script), 0700)
			}
			script := nodePermissionsScript(Policy{NodeTerminal: true, NodeImage: NodeImage})
			script = strings.ReplaceAll(script, "test ! -e /opt/enb/node\n", "")
			script = strings.ReplaceAll(script, "test ! -L /opt/enb/node\n", "")
			cmd := exec.Command("sh", "-c", script, "enb", home)
			log := filepath.Join(home, "log")
			cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "TEST_MODE="+mode, "TEST_LOG="+log)
			out, err := cmd.CombinedOutput()
			success := mode == "success" || mode == "compact-json" || mode == "legacy-image"
			if (err == nil) != success {
				t.Fatalf("unexpected result %v %s", err, out)
			}
			for _, name := range []string{"compose.yaml", ".env"} {
				b, err := os.ReadFile(filepath.Join(target, name))
				if err != nil || string(b) != original[name] {
					t.Fatal("original file changed", name, err)
				}
			}
			b, _ := os.ReadFile(filepath.Join(target, "permissions.yaml"))
			events, _ := os.ReadFile(log)
			if success {
				if !strings.Contains(string(b), "--remote-permissions=terminal") || !strings.Contains(string(events), "recreate") {
					t.Fatal("not applied")
				}
			} else if mode != "symlink" && string(b) != original["permissions.yaml"] {
				t.Fatal("changed permissions after failed preflight")
			}
			if !success && len(events) > 0 {
				t.Fatal("recreated after failure")
			}
		})
	}
}
