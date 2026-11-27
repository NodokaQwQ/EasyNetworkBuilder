package virtualnet

import (
	"crypto/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestOverwriteDeploymentBoundaries(t *testing.T) {
	for _, mode := range []string{"no-confirmation", "success", "down-fails", "pull-fails", "other-project", "symlink", "mountpoint", "container-appeared", "nic-fails"} {
		t.Run(mode, func(t *testing.T) {
			home := t.TempDir()
			home, _ = filepath.EvalSymlinks(home)
			target := filepath.Join(home, "enb", "node")
			if err := os.MkdirAll(target, 0700); err != nil {
				t.Fatal(err)
			}
			old := filepath.Join(target, "old-data")
			os.WriteFile(old, []byte("keep until down succeeds"), 0600)
			os.WriteFile(filepath.Join(target, "compose.yaml"), []byte("old compose"), 0600)
			if mode == "container-appeared" {
				os.RemoveAll(target)
			}
			sibling := filepath.Join(home, "enb", "other-data")
			os.WriteFile(sibling, []byte("unrelated"), 0600)
			if mode == "symlink" {
				moved := filepath.Join(home, "do-not-touch")
				if err := os.Rename(target, moved); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(moved, target); err != nil {
					t.Fatal(err)
				}
			}
			bin := filepath.Join(home, "bin")
			os.Mkdir(bin, 0700)
			os.MkdirAll(filepath.Join(home, "net", "ens3", "device"), 0700)
			scripts := map[string]string{
				"ip": "#!/bin/sh\nif [ \"$TEST_MODE\" = nic-fails ]; then exit 1; fi\necho 'default via 192.0.2.1 dev ens3'\n",
				"docker": `#!/bin/sh
case "$*" in
 *"inspect -f"*) case "$*" in *'project.working_dir'*) if [ "$TEST_MODE" = other-project ]; then printf '/other/project\n'; else printf '%s\n' "$TEST_TARGET"; fi;; *) echo enb-managed-node;; esac;;
 *"ps -aq"*|*"ps -q"*) printf 'owned-container\n';;
 *"ps -a --format"*) printf 'enb-managed-node-node-1 enb-managed-node\n';;
 *" config --quiet"*) printf 'validate\n' >> "$TEST_LOG";;
 *" pull"*) test "$TEST_MODE" != pull-fails;;
 *" down --remove-orphans"*) printf 'down\n' >> "$TEST_LOG"; test "$TEST_MODE" != down-fails;;
 *" up -d"*) printf 'up\n' >> "$TEST_LOG";;
 *" ps --status running"*) printf 'new-container\n';;
esac
`,
				"uname":      "#!/bin/sh\ncase \"$1\" in -m) echo x86_64;; *) echo Linux;; esac\n",
				"flock":      "#!/bin/sh\nexit 0\n",
				"mountpoint": "#!/bin/sh\ntest \"$TEST_MODE\" = mountpoint\n",
				"rm":         "#!/bin/sh\nif [ \"$1\" = -rf ] && [ \"$2\" = --one-file-system ]; then shift 2; exec /bin/rm -rf \"$@\"; fi\nexec /bin/rm \"$@\"\n",
			}
			for name, script := range scripts {
				if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0700); err != nil {
					t.Fatal(err)
				}
			}
			script := deploymentScript(mode != "no-confirmation" && mode != "container-appeared")
			script = strings.ReplaceAll(script, "test ! -e /opt/enb/node\n", "")
			script = strings.ReplaceAll(script, "test ! -L /opt/enb/node\n", "")
			script = strings.ReplaceAll(script, "/sys/class/net/", home+"/net/")
			log := filepath.Join(home, "events")
			cmd := exec.Command("sh", "-c", script, "enb", home)
			cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "TEST_MODE="+mode, "TEST_TARGET="+target, "TEST_LOG="+log)
			cmd.Stdin = strings.NewReader("new test compose\n")
			out, err := cmd.CombinedOutput()
			events, _ := os.ReadFile(log)
			if mode == "success" {
				if err != nil {
					t.Fatalf("overwrite failed: %v %s", err, out)
				}
				if _, err = os.Stat(old); !os.IsNotExist(err) {
					t.Fatal("old directory not replaced")
				}
				data, _ := os.ReadFile(filepath.Join(target, "compose.yaml"))
				if string(data) != "new test compose\n" {
					t.Fatal("new compose missing")
				}
				if string(events) != "validate\ndown\nup\n" {
					t.Fatalf("wrong ordering: %s", events)
				}
				env, _ := os.ReadFile(filepath.Join(target, ".env"))
				if !strings.Contains(string(env), "ENB_HOST_NICS=ens3\n") {
					t.Fatal("host NIC selection not moved from staging")
				}
			} else {
				if err == nil {
					t.Fatal("unsafe overwrite accepted")
				}
				if _, err = os.Stat(old); err != nil && mode != "container-appeared" {
					t.Fatal("old data lost on failed/unconfirmed overwrite")
				}
				if strings.Contains(string(events), "up") {
					t.Fatal("started after failure")
				}
				if (mode == "mountpoint" || mode == "pull-fails" || mode == "nic-fails") && strings.Contains(string(events), "down") {
					t.Fatal("stopped existing project before safety checks/pull passed")
				}
			}
			if _, err = os.Stat(sibling); err != nil {
				t.Fatal("unrelated parent data removed")
			}
		})
	}
}

// Opt-in real Docker check; run only in an isolated Linux test directory.
// It substitutes a unique project name, never the managed production project.
func TestOverwriteRealCompose(t *testing.T) {
	if os.Getenv("ENB_OVERWRITE_COMPOSE_TEST") != "1" {
		t.Skip("requires isolated Linux Docker")
	}
	home := t.TempDir()
	home, _ = filepath.EvalSymlinks(home)
	project := "enb-overwrite-test-" + strings.ToLower(rand.Text()[:12])
	project = strings.ReplaceAll(project, "_", "-")
	target := filepath.Join(home, "enb", "node")
	if err := os.MkdirAll(target, 0700); err != nil {
		t.Fatal(err)
	}
	compose := "services:\n  node:\n    image: alpine:3.23\n    command: [\"sleep\", \"300\"]\n"
	file := filepath.Join(target, "compose.yaml")
	os.WriteFile(file, []byte(compose), 0600)
	cmd := exec.Command("docker", "compose", "-p", project, "-f", file, "up", "-d")
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("fixture start: %v %s", err, b)
	}
	t.Cleanup(func() { exec.Command("docker", "compose", "-p", project, "-f", file, "down").Run() })
	os.WriteFile(filepath.Join(target, "old"), []byte("old"), 0600)
	script := strings.ReplaceAll(deploymentScript(true), "enb-managed-node", project)
	script = strings.ReplaceAll(script, "test ! -e /opt/enb/node\n", "")
	script = strings.ReplaceAll(script, "test ! -L /opt/enb/node\n", "")
	// This isolated test runs inside a container without physical NIC device links.
	// NIC discovery is covered separately; keep the real Compose lifecycle isolated.
	script = strings.ReplaceAll(script, hostNICReport, "printf 'ENB_HOST_NICS=eth0\\n' >> .env\n")
	cmd = exec.Command("sh", "-c", script, "enb", home)
	cmd.Stdin = strings.NewReader(compose)
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("overwrite real compose: %v %s", err, b)
	}
	if _, err := os.Stat(filepath.Join(target, "old")); !os.IsNotExist(err) {
		t.Fatal("old file not removed")
	}
}
