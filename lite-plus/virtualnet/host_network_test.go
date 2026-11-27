package virtualnet

import (
	"crypto/rand"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Opt-in isolated Docker check: harmless sleep service, no host port listeners.
func TestHostNetworkRealCompose(t *testing.T) {
	if os.Getenv("ENB_OVERWRITE_COMPOSE_TEST") != "1" {
		t.Skip("requires isolated Linux Docker")
	}
	dir := t.TempDir()
	compose, err := Compose("test-only-token", Settings{ControlURL: "https://head.example.test", ControlIP: "100.64.0.3"})
	if err != nil {
		t.Fatal(err)
	}
	compose = strings.ReplaceAll(compose, NodeImage, "alpine:3.23")
	compose = strings.ReplaceAll(compose, `["--disable-auto-update"]`, `["sleep", "300"]`)
	file := filepath.Join(dir, "compose.yaml")
	if err = os.WriteFile(file, []byte(compose), 0600); err != nil {
		t.Fatal(err)
	}
	project := "enb-host-test-" + strings.ToLower(rand.Text()[:12])
	run := func(args ...string) ([]byte, error) {
		return exec.Command("docker", append([]string{"compose", "-p", project, "-f", file}, args...)...).CombinedOutput()
	}
	if b, e := run("config", "--quiet"); e == nil {
		t.Fatalf("missing NICs accepted: %s", b)
	}
	if err = os.WriteFile(filepath.Join(dir, ".env"), []byte("ENB_HOST_NICS=ens3,enp1s0\nENB_HOST_IPV6=2602::1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	b, err := run("config", "--format", "json")
	if err != nil {
		t.Fatalf("compose validation: %v %s", err, b)
	}
	var config struct {
		Services map[string]struct {
			NetworkMode string            `json:"network_mode"`
			Environment map[string]string `json:"environment"`
		} `json:"services"`
	}
	if err = json.Unmarshal(b, &config); err != nil {
		t.Fatal(err)
	}
	node := config.Services["node"]
	if node.NetworkMode != "host" || node.Environment["AGENT_INCLUDE_NICS"] != "ens3,enp1s0" {
		t.Fatalf("wrong rendered host configuration: %+v", node)
	}
	t.Cleanup(func() { run("down") })
	if b, err = run("up", "-d", "--no-deps", "node"); err != nil {
		t.Fatalf("start: %v %s", err, b)
	}
	id, err := run("ps", "-q", "node")
	if err != nil {
		t.Fatal(err)
	}
	b, err = exec.Command("docker", "inspect", "-f", "{{.HostConfig.NetworkMode}}", strings.TrimSpace(string(id))).CombinedOutput()
	if err != nil || strings.TrimSpace(string(b)) != "host" {
		t.Fatalf("not using host namespace: %v %s", err, b)
	}
}

func TestHostNICReport(t *testing.T) {
	for _, tc := range []struct{ name, v4, v6, want string }{
		{"single", "default via 192.0.2.1 dev ens3", "default via fe80::1 dev ens3", "ens3"},
		{"dual", "default via 192.0.2.1 dev ens3", "default via fe80::1 dev enp1s0", "enp1s0,ens3"},
		{"ipv6-only", "", "default via fe80::1 dev enp1s0", "enp1s0"},
		{"multipath", "default nexthop via 192.0.2.1 dev ens3 weight 1 nexthop via 192.0.2.2 dev enp1s0 weight 1", "", "enp1s0,ens3"},
		{"no-default", "", "", ""},
		{"overlay", "default dev tun0", "", ""},
		{"bridge", "default dev docker0", "", ""},
		{"mixed-overlay", "default dev ens3", "default dev tun0", ""},
		{"unknown-device", "default dev eth9", "", ""},
		{"injection", "default dev ens3;bad", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			for _, nic := range []string{"ens3", "enp1s0", "tun0", "docker0"} {
				if err := os.MkdirAll(filepath.Join(dir, "net", nic, "device"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			fake := "#!/bin/sh\ncase \"$*\" in *-4*) printf '%s\\n' " + quote(tc.v4) + ";; *) printf '%s\\n' " + quote(tc.v6) + ";; esac\n"
			if err := os.WriteFile(filepath.Join(dir, "ip"), []byte(fake), 0700); err != nil {
				t.Fatal(err)
			}
			os.WriteFile(filepath.Join(dir, ".env"), []byte("ENB_HOST_IPV6=\n"), 0600)
			script := strings.ReplaceAll(hostNICReport, "/sys/class/net/", dir+"/net/")
			cmd := exec.Command("sh", "-c", "set -eu\n"+script)
			cmd.Dir = dir
			cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"))
			out, err := cmd.CombinedOutput()
			if tc.want == "" {
				if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 72 {
					t.Fatalf("unsafe discovery accepted: %v %s", err, out)
				}
			} else if err != nil {
				t.Fatalf("discovery failed: %v %s", err, out)
			}
			data, _ := os.ReadFile(filepath.Join(dir, ".env"))
			want := "ENB_HOST_IPV6=\n"
			if tc.want != "" {
				want += "ENB_HOST_NICS=" + tc.want + "\n"
			}
			if string(data) != want {
				t.Fatalf("bad env: %q", data)
			}
		})
	}
}
