package virtualnet

import (
	"crypto/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestLifecyclePreservesData(t *testing.T) {
	for _, action := range []string{"pause", "resume", "pull-fails", "down-fails", "symlink", "other-project", "extra-service", "different-image"} {
		t.Run(action, func(t *testing.T) {
			home := t.TempDir()
			home, _ = filepath.EvalSymlinks(home)
			target := filepath.Join(home, "enb", "node")
			os.MkdirAll(filepath.Join(target, "nodemgt"), 0700)
			files := map[string]string{"compose.yaml": "original compose", ".env": "original env", "nodemgt/snapshot": "original proxy data"}
			for name, data := range files {
				os.WriteFile(filepath.Join(target, name), []byte(data), 0600)
			}
			if action == "symlink" {
				data := filepath.Join(home, "external-snapshot")
				os.Rename(filepath.Join(target, "nodemgt"), data)
				if err := os.Symlink(data, filepath.Join(target, "nodemgt")); err != nil {
					t.Fatal(err)
				}
			}
			bin := filepath.Join(home, "bin")
			os.Mkdir(bin, 0700)
			fake := `#!/bin/sh
case "$*" in
 *"inspect -f"*) case "$*" in *project.working_dir*) if [ "$TEST_MODE" = other-project ]; then echo /other/path; else echo "$TEST_TARGET"; fi;; *) echo enb-managed-node;; esac;;
 *"ps -aq"*|*"ps -q"*) if [ "$TEST_MODE" = other-project ]; then echo other-container; fi;;
 *"ps -a --format"*) echo 'enb-managed-node-node-1 enb-managed-node';;
 *"config --services"*) if [ "$TEST_MODE" = extra-service ]; then printf 'node\nother\n'; else echo node; fi;;
 *"config --images"*) if [ "$TEST_MODE" = different-image ]; then echo untrusted:image; else echo '` + NodeImage + `'; fi;;
 *"config --quiet"*) echo validate >> "$TEST_LOG";;
 *"pull node"*) echo pull >> "$TEST_LOG"; test "$TEST_MODE" != pull-fails;;
 *"up -d --no-deps node"*) echo up >> "$TEST_LOG";;
 *"down --remove-orphans"*) echo down >> "$TEST_LOG"; test "$TEST_MODE" != down-fails;;
 *"ps --status running"*) echo running-container;;
esac
`
			for name, script := range map[string]string{"docker": fake, "flock": "#!/bin/sh\nexit 0\n", "uname": "#!/bin/sh\necho Linux\n"} {
				os.WriteFile(filepath.Join(bin, name), []byte(script), 0700)
			}
			resume := action == "resume" || action == "pull-fails" || action == "extra-service" || action == "different-image"
			script := strings.ReplaceAll(lifecycleScript(resume), "test ! -e /opt/enb/node\n", "")
			script = strings.ReplaceAll(script, "test ! -L /opt/enb/node\n", "")
			log := filepath.Join(home, "events")
			cmd := exec.Command("sh", "-c", script, "enb", home)
			cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "TEST_TARGET="+target, "TEST_MODE="+action, "TEST_LOG="+log)
			cmd.Stdin = strings.NewReader("services:\n  node:\n    image: test\n")
			out, err := cmd.CombinedOutput()
			if (err == nil) != (action == "pause" || action == "resume") {
				t.Fatalf("bad outcome %v %s", err, out)
			}
			for name, want := range files {
				got, err := os.ReadFile(filepath.Join(target, name))
				if err != nil || string(got) != want {
					t.Fatalf("data changed: %s", name)
				}
			}
			events, _ := os.ReadFile(log)
			if resume && strings.Contains(string(events), "down") {
				t.Fatal("resume stopped installation")
			}
			if action == "pull-fails" && strings.Contains(string(events), "up") {
				t.Fatal("started after pull failure")
			}
		})
	}
}

func TestLifecycleRealCompose(t *testing.T) {
	if os.Getenv("ENB_OVERWRITE_COMPOSE_TEST") != "1" {
		t.Skip("requires isolated Linux Docker")
	}
	home := t.TempDir()
	home, _ = filepath.EvalSymlinks(home)
	target := filepath.Join(home, "enb", "node")
	os.MkdirAll(filepath.Join(target, "nodemgt"), 0700)
	project := "enb-lifecycle-test-" + strings.ToLower(rand.Text()[:12])
	compose := "services:\n  node:\n    image: alpine:3.23\n    command: [\"sleep\", \"300\"]\n"
	file := filepath.Join(target, "compose.yaml")
	os.WriteFile(file, []byte(compose), 0600)
	datafile := filepath.Join(target, "nodemgt", "snapshot")
	os.WriteFile(datafile, []byte("retain"), 0600)
	cmd := exec.Command("docker", "compose", "-p", project, "-f", file, "up", "-d")
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("start fixture %v %s", e, b)
	}
	t.Cleanup(func() { exec.Command("docker", "compose", "-p", project, "-f", file, "down").Run() })
	for _, resume := range []bool{false, true} {
		script := strings.ReplaceAll(lifecycleScript(resume), "enb-managed-node", project)
		script = strings.ReplaceAll(script, NodeImage, "alpine:3.23")
		script = strings.ReplaceAll(script, "test ! -e /opt/enb/node\n", "")
		script = strings.ReplaceAll(script, "test ! -L /opt/enb/node\n", "")
		cmd = exec.Command("sh", "-c", script, "enb", home)
		cmd.Stdin = strings.NewReader(compose)
		if b, e := cmd.CombinedOutput(); e != nil {
			t.Fatalf("lifecycle resume=%v: %v %s", resume, e, b)
		}
		b, e := os.ReadFile(datafile)
		if e != nil || string(b) != "retain" {
			t.Fatal("retained data lost")
		}
		b, e = os.ReadFile(file)
		if e != nil || string(b) != compose {
			t.Fatal("compose changed")
		}
		b, e = exec.Command("docker", "ps", "-q", "--filter", "label=com.docker.compose.project="+project).Output()
		if e != nil || (len(strings.TrimSpace(string(b))) > 0) != resume {
			t.Fatal("wrong container running state")
		}
	}
}
