package virtualnet

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRelayCandidateOrderingAndAuthorization(t *testing.T) {
	peers := []Peer{{ID: "a", IPv4: "10.0.0.10"}, {ID: "b", IPv4: "10.0.0.2"}, {ID: "c", IPv4: "10.0.0.1"}, {ID: "d", IPv4: "10.0.0.3"}}
	profile := func(id, addr string) Profile {
		return Profile{PeerID: id, Address: addr, AuthType: "password", Password: "encrypted-fixture", Fingerprint: "pinned"}
	}
	profiles := []Profile{profile("a", "10.0.0.10"), profile("b", "10.0.0.2"), profile("c", "10.0.0.1"), profile("d", "10.0.0.99")}
	policies := []Policy{{PeerID: "a", NodeDocker: true}, {PeerID: "b", NodeDocker: true}, {PeerID: "d", NodeDocker: true}}
	got := RelayCandidates(peers, profiles, policies, "target")
	if len(got) != 2 || got[0].PeerID != "b" || got[1].PeerID != "a" {
		t.Fatalf("unsafe order/candidates: %+v", got)
	}
	if got = RelayCandidates(peers, profiles, policies, "b"); len(got) != 1 || got[0].PeerID != "a" {
		t.Fatal("target not excluded")
	}
}

func TestImageAcquisitionShellCacheAndFailure(t *testing.T) {
	for _, cached := range []bool{true, false} {
		dir := t.TempDir()
		fake := `#!/bin/sh
case "$*" in
"image inspect -f"*) echo linux/amd64;;
"image inspect"*) test "$CACHED" = yes;;
"pull"*) echo pull >> "$LOG"; exit 1;;
esac
`
		if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(fake), 0700); err != nil {
			t.Fatal(err)
		}
		cache := "no"
		if cached {
			cache = "yes"
		}
		cmd := exec.Command("sh", "-c", imageReadyScript(testNodeRelease().Image))
		cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "CACHED="+cache, "LOG="+filepath.Join(dir, "log"))
		b, err := cmd.CombinedOutput()
		if cached && err != nil {
			t.Fatalf("cached image failed: %v %s", err, b)
		}
		if !cached && err == nil {
			t.Fatal("failed pull was accepted")
		}
		_, statErr := os.Stat(filepath.Join(dir, "log"))
		if cached && !os.IsNotExist(statErr) {
			t.Fatal("cached image triggered pull")
		}
		if !cached && statErr != nil {
			t.Fatal("uncached image did not attempt pull")
		}
	}
}

func TestImagePullTimeoutAndCache(t *testing.T) {
	script := imageReadyScript(testNodeRelease().Image)
	for _, want := range []string{"if ! docker image inspect", "timeout -s TERM -k 2 20 docker pull", "--platform linux/amd64"} {
		if !strings.Contains(script, want) {
			t.Fatal("missing", want)
		}
	}
	if strings.Contains(script, " stop ") || strings.Contains(script, " down ") {
		t.Fatal("image fetch changes running service")
	}
}
