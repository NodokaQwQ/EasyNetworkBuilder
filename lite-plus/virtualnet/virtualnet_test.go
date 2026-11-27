package virtualnet

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nuomiiiii/lite/database/models"
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

func TestReconcileDeletedNodeAssociations(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&models.Client{}, &Profile{}, &Job{}); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&models.Client{UUID: "live", Token: "test"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, p := range []Profile{
		{PeerID: "deleted", NodeUUID: "gone", AuthType: "key", PrivateKey: "sealed"},
		{PeerID: "live", NodeUUID: "live"},
		{PeerID: "running", NodeUUID: "new"},
	} {
		if err = db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Create(&Job{ID: "job", PeerID: "running", Status: "running"}).Error; err != nil {
		t.Fatal(err)
	}
	if err = ReconcileNodeAssociations(db); err != nil {
		t.Fatal(err)
	}
	var ps []Profile
	db.Find(&ps)
	for _, p := range ps {
		switch p.PeerID {
		case "deleted":
			if p.NodeUUID != "" || p.PrivateKey != "sealed" {
				t.Fatal("stale association or credentials corrupted")
			}
		case "live":
			if p.NodeUUID != "live" {
				t.Fatal("live association released")
			}
		case "running":
			if p.NodeUUID != "new" {
				t.Fatal("in-flight registration released")
			}
		}
	}
	db.Model(&Job{}).Where("id = ?", "job").Update("status", "failed")
	if err = ReconcileNodeAssociations(db); err != nil {
		t.Fatal(err)
	}
	var p Profile
	db.First(&p, "peer_id = ?", "running")
	if p.NodeUUID != "" {
		t.Fatal("deleted registration remained after job finished")
	}
}

func TestNodeNameUsesDeviceHostname(t *testing.T) {
	if got := (Peer{ID: "42", Hostname: " example-node "}).NodeName(); got != "example-node" {
		t.Fatal(got)
	}
	if got := (Peer{ID: "42"}).NodeName(); got != "EasyTier-42" {
		t.Fatal(got)
	}
	if got := (Peer{Hostname: strings.Repeat("名", 101)}).NodeName(); len([]rune(got)) != 100 {
		t.Fatal("name too long")
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
	in := ProfileInput{PeerID: "2", Address: "100.64.0.7", Port: 22, Username: "root", Fingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", AuthType: "password", Password: "test-password"}
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
	db.Model(&Profile{}).Where("peer_id = ?", in.PeerID).Update("paused", true)
	in.Fingerprint = "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA"
	in.Password = "fresh-password"
	if e = SaveProfile(db, in); e != nil {
		t.Fatal(e)
	}
	db.First(&p, "peer_id = ?", in.PeerID)
	if p.NodeUUID != "existing-node" {
		t.Fatal("node association lost when updating SSH identity")
	}
	if !p.Paused {
		t.Fatal("pause state lost after SSH identity update")
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

func TestFingerprintValidation(t *testing.T) {
	if !validFingerprint("SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") {
		t.Fatal("valid SHA256 fingerprint rejected")
	}
	for _, value := range []string{"SHA256:", "SHA256:test", "MD5:1234", "SHA256:!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"} {
		if validFingerprint(value) {
			t.Fatal("malformed fingerprint accepted")
		}
	}
}

func TestComposeAndEndpoint(t *testing.T) {
	c, e := Compose("a$b", Settings{ControlURL: "https://head.internal"})
	if e != nil {
		t.Fatal(e)
	}
	for _, s := range []string{"a$$b", "--disable-auto-update", "./nodemgt:/app/nodemgt", "@sha256:", `AGENT_CUSTOM_IPV6: "${ENB_HOST_IPV6:-}"`, "network_mode: host", `AGENT_INCLUDE_NICS: "${ENB_HOST_NICS:?host uplink NICs must be configured}"`} {
		if !strings.Contains(c, s) {
			t.Fatalf("missing %s", s)
		}
	}
	if strings.Contains(c, "docker.sock") || strings.Contains(c, "privileged:") {
		t.Fatal("excessive permissions")
	}
	if _, e := (Settings{ControlURL: "http://insecure"}).Endpoint(); e == nil {
		t.Fatal("plaintext control accepted")
	}
}

func TestControlHostMapping(t *testing.T) {
	s := Settings{ControlURL: "https://network.example.test", ControlIP: "100.64.0.3"}
	if _, err := s.Endpoint(); err != nil {
		t.Fatal(err)
	}
	c, err := Compose("test-token", s)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c, `"network.example.test=100.64.0.3"`) || !strings.Contains(c, `AGENT_ENDPOINT: "https://network.example.test"`) {
		t.Fatal("control mapping must preserve TLS hostname")
	}
	for _, ip := range []string{"127.0.0.1", "0.0.0.0", "224.0.0.1", "invalid", "fe80::1%eth0"} {
		s.ControlIP = ip
		if _, err := s.Endpoint(); err == nil {
			t.Fatalf("invalid mapping accepted: %s", ip)
		}
	}
	s.ControlIP = "fd00::3"
	if _, err := Compose("test-token", s); err != nil {
		t.Fatal(err)
	}
}

func TestSettingsPersistence(t *testing.T) {
	// Page/database configuration is authoritative, not deployment environment.
	t.Setenv("ENB_NODE_CONTROL_URL", "https://environment.example.test")
	t.Setenv("ENB_NODE_CONTROL_IP", "100.64.0.99")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&Settings{}); err != nil {
		t.Fatal(err)
	}
	empty, err := LoadSettings(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = empty.Endpoint(); err == nil {
		t.Fatal("unset settings enabled deployment")
	}
	s := Settings{ControlURL: " https://custom.example.test:8443/ ", ControlIP: " 100.64.0.3 ", EasyTierRPC: " 127.0.0.1:15888 ", EasyTierInstance: " custom-instance "}
	if err = SaveSettings(db, s); err != nil {
		t.Fatal(err)
	}
	got, err := LoadSettings(db)
	if got.EasyTierRPC != "127.0.0.1:15888" || got.EasyTierInstance != "custom-instance" { t.Fatal("EasyTier settings not persisted", got) }
	for _, address := range []string{"bad", "localhost:0", "localhost:99999", ":15888"} {
		if SaveSettings(db, Settings{EasyTierRPC: address}) == nil { t.Fatal("invalid RPC accepted", address) }
	}
	if err != nil || got.ControlURL != "https://custom.example.test:8443" || got.ControlIP != "100.64.0.3" {
		t.Fatalf("bad settings: %+v %v", got, err)
	}
	for _, endpoint := range []string{"http://example.test", "https://user:pass@example.test", "https://example.test/path", "https://example.test?q=x", "https://example.test:99999"} {
		if err = SaveSettings(db, Settings{ControlURL: endpoint}); err == nil {
			t.Fatalf("invalid URL accepted: %s", endpoint)
		}
	}
	if err = SaveSettings(db, Settings{ControlURL: "https://" + strings.Repeat("a", 2050)}); err == nil {
		t.Fatal("oversized settings accepted")
	}
	if err = SaveSettings(db, Settings{}); err != nil {
		t.Fatal(err)
	}
	got, err = LoadSettings(db)
	if err != nil || got.ControlURL != "" || got.ControlIP != "" {
		t.Fatal("clear failed")
	}
}

func TestForgetCredentialsPreservesAssociation(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&Profile{}, &Job{}); err != nil {
		t.Fatal(err)
	}
	p := Profile{PeerID: "2", NodeUUID: "managed-node", AuthType: "password", Password: "sealed", PrivateKey: "sealed-key", Passphrase: "sealed-pass", Sudo: true, SudoPassword: "sealed-sudo"}
	if err = db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	if !p.CredentialsPresent() {
		t.Fatal("missing credentials")
	}
	if err = ForgetCredentials(db, p.PeerID); err != nil {
		t.Fatal(err)
	}
	var got Profile
	if err = db.First(&got, "peer_id = ?", p.PeerID).Error; err != nil {
		t.Fatal(err)
	}
	if got.NodeUUID != p.NodeUUID || got.CredentialsPresent() || got.Password != "" || got.PrivateKey != "" || got.Passphrase != "" || got.SudoPassword != "" || got.Sudo {
		t.Fatalf("association or credential erasure incorrect: %+v", got)
	}
	if err = UpdateJob(db, "missing", "", "running", "compose", ""); err == nil {
		t.Fatal("missing job accepted")
	}
	j := Job{ID: "job", PeerID: p.PeerID, Status: "running"}
	if err = db.Create(&j).Error; err != nil {
		t.Fatal(err)
	}
	if err = UpdateJob(db, j.ID, p.NodeUUID, "succeeded", "online", ""); err != nil {
		t.Fatal(err)
	}
	if err = db.First(&j, "id = ?", j.ID).Error; err != nil {
		t.Fatal(err)
	}
	if j.Status != "succeeded" || j.NodeUUID != p.NodeUUID || j.Stage != "online" {
		t.Fatal("job not updated")
	}
}

func TestDiscoveryRejectsIncompatibleRoutes(t *testing.T) {
	for _, raw := range []string{
		`{"node_info":{"peer_id":1}}`,
		`{"node_info":{"peer_id":1},"peer_routes":[{}]}`,
		`{"node_info":{"peer_id":1},"peer_routes":[{"route":{"peer_id":-2}}]}`,
		`{"node_info":{"peer_id":4294967296},"peer_routes":[]}`,
		`{"node_info":{"peer_id":1.2},"peer_routes":[]}`,
	} {
		if _, err := ParseRoutes([]byte(raw)); err == nil {
			t.Fatalf("incompatible schema accepted: %s", raw)
		}
	}
}
