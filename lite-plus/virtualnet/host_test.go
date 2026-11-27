package virtualnet

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nuomiiiii/lite/nodemgt/secretcrypt"
	"github.com/nuomiiiii/lite/utils/instancekey"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// Real SSH exec/subsystem transport, isolated to a temporary directory. A bogus
// encrypted sudo password proves shell and SFTP never use deployment sudo.
func TestHostSSHCommandAndSFTP(t *testing.T) {
	dir := t.TempDir()
	dir, _ = filepath.EvalSymlinks(dir)
	t.Setenv("LITE_INSTANCE_KEY_FILE", filepath.Join(dir, "instance-key"))
	instancekey.Reload()
	defer instancekey.Reload()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				server, channels, requests, err := ssh.NewServerConn(conn, config)
				if err != nil {
					return
				}
				defer server.Close()
				go ssh.DiscardRequests(requests)
				for channel := range channels {
					ch, requests, err := channel.Accept()
					if err != nil {
						return
					}
					go func() {
						defer ch.Close()
						for request := range requests {
							switch request.Type {
							case "exec":
								var payload struct{ Command string }
								if ssh.Unmarshal(request.Payload, &payload) != nil {
									return
								}
								request.Reply(true, nil)
								cmd := exec.Command("sh", "-c", payload.Command)
								cmd.Dir = dir
								cmd.Stdin = ch
								cmd.Stdout = ch
								cmd.Stderr = ch.Stderr()
								status := uint32(0)
								if cmd.Run() != nil {
									status = 1
								}
								ch.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{status}))
								return
							case "subsystem":
								var payload struct{ Name string }
								ssh.Unmarshal(request.Payload, &payload)
								if payload.Name != "sftp" {
									request.Reply(false, nil)
									return
								}
								request.Reply(true, nil)
								s, err := sftp.NewServer(ch, sftp.WithServerWorkingDirectory(dir))
								if err == nil {
									s.Serve()
									s.Close()
								}
								return
							default:
								request.Reply(false, nil)
							}
						}
					}()
				}
			}()
		}
	}()
	host, port, _ := net.SplitHostPort(listener.Addr().String())
	n, _ := strconv.Atoi(port)
	password, err := secretcrypt.Seal("fixture")
	if err != nil {
		t.Fatal(err)
	}
	p := Profile{PeerID: "42", Address: host, Port: n, Username: "fixture", AuthType: "password", Password: password, Fingerprint: ssh.FingerprintSHA256(signer.PublicKey()), Sudo: true, SudoPassword: "invalid-ciphertext-must-not-be-used"}
	policy := PolicyInput{Policy: Policy{HostExec: true, HostFiles: true}}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	result, err := HostOperation(ctx, p, policy, HostRequest{Operation: "exec", Command: "printf ssh-works"})
	if err != nil || result.(map[string]any)["output"] != "ssh-works" {
		t.Fatal(result, err)
	}
	file := filepath.Join(dir, "upload.txt")
	_, err = HostOperation(ctx, p, policy, HostRequest{Operation: "upload", Path: file, Data: base64.StdEncoding.EncodeToString([]byte("test-data"))})
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(file)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("unsafe upload mode", info, err)
	}
	_, err = HostOperation(ctx, p, policy, HostRequest{Operation: "upload", Path: file, Data: "Yg=="})
	if err == nil {
		t.Fatal("existing file overwritten")
	}
	result, err = HostOperation(ctx, p, policy, HostRequest{Operation: "download", Path: file})
	if err != nil || result.(map[string]string)["data"] != base64.StdEncoding.EncodeToString([]byte("test-data")) {
		t.Fatal(result, err)
	}
	result, err = HostOperation(ctx, p, policy, HostRequest{Operation: "list", Path: dir})
	if err != nil || !strings.Contains(result.(map[string]any)["path"].(string), dir) {
		t.Fatal(result, err)
	}
	p.Fingerprint = "SHA256:wrong"
	if _, err = HostOperation(ctx, p, policy, HostRequest{Operation: "exec", Command: "printf forbidden"}); err == nil || !strings.Contains(err.Error(), "host key mismatch") {
		t.Fatal("pinning bypass", err)
	}
}
