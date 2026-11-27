package virtualnet

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Isolated real image/Compose transaction. No production endpoint or credentials.
func TestNodePermissionsMigrationRealCompose(t *testing.T) {
	if os.Getenv("ENB_NODE_MIGRATION_TEST") != "1" {
		t.Skip("requires isolated Docker image migration acceptance")
	}
	home := t.TempDir()
	target := filepath.Join(home, "enb", "node")
	if err := os.MkdirAll(filepath.Join(target, "nodemgt"), 0700); err != nil {
		t.Fatal(err)
	}
	project := "enb-migration-" + filepath.Base(home)
	project = strings.ToLower(strings.ReplaceAll(project, "_", "-"))
	release := testNodeRelease()
	release.Image = "docker.io/nodokaqwq/enb@sha256:04f716e274957d78ce4bfef155b82ccbb9ca1ab70eaae4d80ae3f3a47cc24d6b"
	release.FromVersions = []string{"0.2.1-enb-permissions.1"}
	compose := `services:
  node:
    image: ` + NodeImage + `
    command: ["--disable-auto-update", "--endpoint", "http://127.0.0.1:1", "--token", "isolated-test-only", "--remote-permissions", "none"]
    network_mode: none
    volumes:
      - ./nodemgt:/app/nodemgt
`
	for name, value := range map[string]string{"compose.yaml": compose, ".env": "ENB_HOST_NICS=fixture0\n", "permissions.yaml": "services:\n  node:\n    command: [\"--disable-auto-update\", \"--endpoint\", \"http://127.0.0.1:1\", \"--token\", \"isolated-test-only\", \"--remote-permissions\", \"none\"]\n", "nodemgt/marker": "original-state"} {
		if err := os.WriteFile(filepath.Join(target, name), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	docker := func(args ...string) string {
		t.Helper()
		b, err := exec.Command("docker", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("docker %v: %v %s", args, err, b)
		}
		return strings.TrimSpace(string(b))
	}
	base := []string{"compose", "-p", project, "-f", filepath.Join(target, "compose.yaml"), "-f", filepath.Join(target, "permissions.yaml")}
	t.Cleanup(func() { exec.Command("docker", append(base, "down")...).Run() })
	docker("pull", NodeImage)
	docker(append(base, "up", "-d")...)
	id := strings.Repeat("b", 32)
	action := func(name string) {
		t.Helper()
		script, err := nodeUpdateScript(release, id, name)
		if err != nil {
			t.Fatal(err)
		}
		// Scope all container queries and project names to this isolated fixture.
		script = strings.ReplaceAll(script, "enb-managed-node", project)
		script = strings.ReplaceAll(script, "--filter label=com.docker.compose.project)", "--filter label=com.docker.compose.project="+project+")")
		script = strings.ReplaceAll(script, "docker ps -a --format", "docker ps -a --filter label=com.docker.compose.project="+project+" --format")
		cmd := exec.Command("sh", "-c", script, "enb", home)
		if b, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v %s", name, err, b)
		}
	}
	action("prepare")
	for name, expected := range map[string]string{"compose.yaml": compose, ".env": "ENB_HOST_NICS=fixture0\n", "nodemgt/marker": "original-state"} {
		b, _ := os.ReadFile(filepath.Join(target, name))
		if string(b) != expected {
			t.Fatalf("changed retained file: %s", name)
		}
	}
	// Roll back the actual permissions.1 -> 0.0.1 switch before committing
	// a second transaction, exercising both terminal paths from the old image.
	os.WriteFile(filepath.Join(target, "nodemgt", "marker"), []byte("failed-state"), 0600)
	action("rollback")
	b, _ := os.ReadFile(filepath.Join(target, "nodemgt", "marker"))
	if string(b) != "original-state" {
		t.Fatal("snapshot not restored")
	}
	b, _ = os.ReadFile(filepath.Join(target, ".enb-update-"+id, "failed-nodemgt", "marker"))
	if string(b) != "failed-state" {
		t.Fatal("failed data not retained")
	}
	action("finish_rollback")
	id = strings.Repeat("c", 32)
	action("prepare")
	action("commit")
	info := docker("inspect", docker(append(base, "ps", "-q", "node")...))
	var containers []struct{ State struct{ Running bool } }
	if json.Unmarshal([]byte(info), &containers) != nil || len(containers) != 1 || !containers[0].State.Running {
		t.Fatal("node not running after rollback")
	}
}
