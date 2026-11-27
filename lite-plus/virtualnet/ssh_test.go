package virtualnet

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/nuomiiiii/lite/nodemgt/secretcrypt"
	"github.com/nuomiiiii/lite/utils/instancekey"
	"golang.org/x/crypto/ssh"
)

func TestSSHHostKeyPinningBeforeAuthentication(t *testing.T) {
	t.Setenv("LITE_INSTANCE_KEY_FILE", filepath.Join(t.TempDir(), "key"))
	instancekey.Reload()
	defer instancekey.Reload()
	_, private, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	signer, e := ssh.NewSignerFromKey(private)
	if e != nil {
		t.Fatal(e)
	}
	ln, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer ln.Close()
	auth := make(chan bool, 8)
	config := &ssh.ServerConfig{PasswordCallback: func(_ ssh.ConnMetadata, p []byte) (*ssh.Permissions, error) {
		auth <- true
		if string(p) != "test-password" {
			return nil, errors.New("bad password")
		}
		return nil, nil
	}}
	config.AddHostKey(signer)
	go func() {
		for {
			c, e := ln.Accept()
			if e != nil {
				return
			}
			go func() {
				defer c.Close()
				s, ch, req, e := ssh.NewServerConn(c, config)
				if e == nil {
					go ssh.DiscardRequests(req)
					go func() {
						for c := range ch {
							c.Reject(ssh.Prohibited, "not needed")
						}
					}()
					s.Wait()
				}
			}()
		}
	}()
	host, port, _ := net.SplitHostPort(ln.Addr().String())
	n, _ := strconv.Atoi(port)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	fp, e := Fingerprint(ctx, host, n)
	if e != nil || fp != ssh.FingerprintSHA256(signer.PublicKey()) {
		t.Fatalf("probe failed: %v", e)
	}
	select {
	case <-auth:
		t.Fatal("probe sent credentials")
	default:
	}
	password, e := secretcrypt.Seal("test-password")
	if e != nil {
		t.Fatal(e)
	}
	p := Profile{Address: host, Port: n, Username: "root", AuthType: "password", Password: password, Fingerprint: "SHA256:wrong"}
	if c, _, e := connect(ctx, p, false); e == nil {
		c.Close()
		t.Fatal("wrong host key accepted")
	}
	select {
	case <-auth:
		t.Fatal("credentials sent before host key verification")
	default:
	}
	p.Fingerprint = fp
	c, _, e := connect(ctx, p, false)
	if e != nil {
		t.Fatal(e)
	}
	c.Close()
	select {
	case <-auth:
	default:
		t.Fatal("correct host did not authenticate")
	}
}
