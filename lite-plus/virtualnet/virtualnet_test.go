package virtualnet

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nuomiiiii/lite/nodemgt/secretcrypt"
	"github.com/nuomiiiii/lite/utils/instancekey"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDiscoveryAllowlist(t *testing.T) {
	raw := []byte(`{"node_info":{"peer_id":1,"hostname":"head","ipv4_addr":"100.64.0.3/24","config":"network_secret=DO-NOT-LEAK"},"peer_routes":[{"route":{"peer_id":2,"hostname":"node","ipv4_addr":{"address":{"addr":1681915911},"network_length":24},"ipv6_addr":{"address":{"part1":4244635648,"part2":0,"part3":0,"part4":7},"network_length":64},"cost":1,"path_latency":12,"network_secret":"ALSO-SECRET"}}]}`)
	peers, e := ParseRoutes(raw)
	if e != nil {
		t.Fatal(e)
	}
	if len(peers) != 2 || peers[1].IPv4 != "100.64.0.7" || peers[1].IPv6 != "fd00::7" {
		t.Fatalf("unexpected peers: %+v", peers)
	}
	b, _ := json.Marshal(peers)
	if strings.Contains(string(b), "SECRET") || strings.Contains(string(b), "config") {
		t.Fatal("secret leaked")
	}
	if _, e := ParseRoutes([]byte(`{"instances":[]}`)); e == nil {
		t.Fatal("unsupported schema accepted")
	}
}

func TestDiscoverFixedCommand(t *testing.T) {
	d := t.TempDir()
	bin := filepath.Join(d, "cli")
	script := `#!/bin/sh
test "$1" = '-p' && test "$2" = '127.0.0.1:15888' && test "$3" = '-o' && test "$4" = 'json' && test "$5" = '-v' && test "$6" = 'route' || exit 1
printf '%s' '{"node_info":{"peer_id":1,"ipv4_addr":"100.64.0.3/24"},"peer_routes":[]}'
`
	if e := os.WriteFile(bin, []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	t.Setenv("ENB_EASYTIER_CLI", bin)
	t.Setenv("ENB_EASYTIER_RPC", "127.0.0.1:15888")
	t.Setenv("ENB_EASYTIER_INSTANCE", "")
	if _, e := Discover(context.Background()); e != nil {
		t.Fatal(e)
	}
	if _, e := FindPeer(context.Background(), "1", "100.64.0.3"); e == nil {
		t.Fatal("local deployment accepted")
	}
	if _, e := FindPeer(context.Background(), "2", "127.0.0.1"); e == nil {
		t.Fatal("loopback accepted")
	}
}

func TestCredentialsEncryptedAndHidden(t *testing.T) {
	t.Setenv("LITE_INSTANCE_KEY_FILE", filepath.Join(t.TempDir(), "instance.key"))
	instancekey.Reload()
	defer instancekey.Reload()
	db, e := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if e != nil {
		t.Fatal(e)
	}
	if e = db.AutoMigrate(&Profile{}); e != nil {
		t.Fatal(e)
	}
	in := ProfileInput{PeerID: "2", Address: "100.64.0.7", Port: 22, Username: "root", Fingerprint: "SHA256:test", AuthType: "password", Password: "test-password"}
	if e = SaveProfile(db, in); e != nil {
		t.Fatal(e)
	}
	var p Profile
	db.First(&p)
	if p.Password == in.Password || !strings.HasPrefix(p.Password, secretcrypt.Prefix) {
		t.Fatal("plaintext credential stored")
	}
	b, _ := json.Marshal(p)
	if strings.Contains(string(b), `"password":`) || strings.Contains(string(b), "test-password") || strings.Contains(string(b), "enc:v1:") {
		t.Fatal("credential returned")
	}
	in.Password = ""
	if e = SaveProfile(db, in); e != nil {
		t.Fatal(e)
	}
	db.Model(&Profile{}).Where("peer_id = ?", in.PeerID).Update("node_uuid", "existing-node")
	in.Fingerprint = "SHA256:changed"
	in.Password = "fresh-password"
	if e = SaveProfile(db, in); e != nil {
		t.Fatal(e)
	}
	db.First(&p, "peer_id = ?", in.PeerID)
	if p.NodeUUID != "existing-node" {
		t.Fatal("node association lost when updating SSH identity")
	}
	in.Password = ""
	in.Address = "100.64.0.8"
	if e = SaveProfile(db, in); e == nil {
		t.Fatal("credential reused for changed endpoint")
	}
	in.Password = secretcrypt.Prefix + "attacker"
	if e = SaveProfile(db, in); e == nil {
		t.Fatal("ciphertext injection allowed")
	}
}

func TestComposeAndEndpoint(t *testing.T) {
	c, e := Compose("a$b", "https://head.internal")
	if e != nil {
		t.Fatal(e)
	}
	for _, s := range []string{"a$$b", "--disable-auto-update", "./nodemgt:/app/nodemgt", "@sha256:"} {
		if !strings.Contains(c, s) {
			t.Fatalf("missing %s", s)
		}
	}
	if strings.Contains(c, "docker.sock") || strings.Contains(c, "privileged:") {
		t.Fatal("excessive permissions")
	}
	t.Setenv("ENB_NODE_CONTROL_URL", "http://insecure")
	if _, e := Endpoint(); e == nil {
		t.Fatal("plaintext control accepted")
	}
}
