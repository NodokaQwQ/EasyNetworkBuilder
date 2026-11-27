package sub

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestRealitySubscriptionsEnableMLKEM(t *testing.T) {
	nodes := []Node{{Name: "Reality", Protocol: "vless", Host: "example.com", Port: 443, UUID: "00000000-0000-4000-8000-000000000001", Security: "reality", PublicKey: "pk", ShortID: "ab12", Type: "tcp"}}
	if !strings.Contains(RenderClash(nodes, nil), "support-x25519mlkem768: true") {
		t.Fatal("legacy Clash subscription must enable Reality MLKEM")
	}
	links, err := base64.StdEncoding.DecodeString(RenderV2RayBase64(nodes, nil))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(links), "support-x25519mlkem768=true") {
		t.Fatal("Reality share URI must include the MLKEM hint")
	}
	nodes[0].Security = "tls"
	if strings.Contains(RenderClash(nodes, nil), "support-x25519mlkem768") {
		t.Fatal("ordinary TLS must not gain Reality options")
	}
}
