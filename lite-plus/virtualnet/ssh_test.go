package virtualnet

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
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
	} else if !strings.Contains(e.Error(), "SSH host key mismatch") {
		t.Fatalf("host key failure not distinguished: %v", e)
	}
	select {
	case <-auth:
		t.Fatal("credentials sent before host key verification")
	default:
	}
	p.Fingerprint = fp
	badPassword, e := secretcrypt.Seal("wrong-password")
	if e != nil {
		t.Fatal(e)
	}
	p.Password = badPassword
	if c, _, e := connect(ctx, p, false); e == nil {
		c.Close()
		t.Fatal("wrong password accepted")
	} else if !strings.Contains(e.Error(), "SSH authentication failed") {
		t.Fatalf("authentication failure not distinguished: %v", e)
	}
	<-auth // The failed password reached only the verified host.
	p.Password = password
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

func TestHandshakeErrorSanitization(t *testing.T) {
	for _, input := range []struct {
		err      error
		mismatch bool
		want     string
	}{
		{errors.New("attacker-controlled-secret"), true, "SSH host key mismatch"},
		{&net.DNSError{IsTimeout: true}, false, "SSH handshake timed out"},
		{errors.New("ssh: unable to authenticate attacker-controlled-secret"), false, "SSH authentication failed"},
		{errors.New("attacker-controlled-secret"), false, "SSH handshake failed"},
	} {
		got := classifyHandshakeError(context.Background(), input.err, input.mismatch).Error()
		if !strings.Contains(got, input.want) || strings.Contains(got, "attacker-controlled") {
			t.Fatalf("bad sanitized category: %s", got)
		}
	}
}

// Exercise actual SSH exec/stdin transport with an isolated fake sudo executable.
// This verifies the token-bearing document and sudo password never share a shell argument.
func TestSSHCommandStdinAndSudo(t *testing.T) {
	t.Setenv("LITE_INSTANCE_KEY_FILE", filepath.Join(t.TempDir(), "key"))
	instancekey.Reload()
	defer instancekey.Reload()
	for _, mode := range []string{"passwordless", "password", "cached", "wrong-password"} {
		t.Run(mode, func(t *testing.T) {
			password := "sudo-test-password"
			if mode == "passwordless" {
				password = ""
			}
			if mode == "wrong-password" {
				password = "incorrect"
			}
			dir := t.TempDir()
			fakeSudo := `#!/bin/sh
if [ "$1" = -S ]; then
  shift
  test "$1" = -p && test "$2" = '' || exit 1
  shift 2
  # Model timestamp_timeout=0: -v must never be used, only direct execution.
  test "$1" = -- || exit 1
  shift
  if [ "$ENB_TEST_SUDO_MODE" != cached ]; then
    IFS= read -r password
    test "$password" = sudo-test-password || exit 1
  fi
  HOME=/root
  export HOME
  exec "$@"
fi
test "$1" = -n || exit 1
shift
test "$1" = -- || exit 1
shift
HOME=/root
export HOME
exec "$@"
`
			if err := os.WriteFile(filepath.Join(dir, "sudo"), []byte(fakeSudo), 0700); err != nil {
				t.Fatal(err)
			}
			_, key, _ := ed25519.GenerateKey(rand.Reader)
			signer, _ := ssh.NewSignerFromKey(key)
			config := &ssh.ServerConfig{NoClientAuth: true}
			config.AddHostKey(signer)
			ln, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer ln.Close()
			serverDone := make(chan error, 1)
			go func() {
				conn, err := ln.Accept()
				if err != nil {
					serverDone <- err
					return
				}
				defer conn.Close()
				server, channels, requests, err := ssh.NewServerConn(conn, config)
				if err != nil {
					serverDone <- err
					return
				}
				defer server.Close()
				go ssh.DiscardRequests(requests)
				channel := <-channels
				ch, reqs, err := channel.Accept()
				if err != nil {
					serverDone <- err
					return
				}
				defer ch.Close()
				for req := range reqs {
					if req.Type != "exec" {
						_ = req.Reply(false, nil)
						continue
					}
					var payload struct{ Command string }
					if err = ssh.Unmarshal(req.Payload, &payload); err != nil {
						serverDone <- err
						return
					}
					if strings.Contains(payload.Command, "sudo-test-password") || strings.Contains(payload.Command, "test-token") {
						serverDone <- errors.New("secret in arguments")
						return
					}
					_ = req.Reply(true, nil)
					cmd := exec.Command("sh", "-c", payload.Command)
					cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "ENB_TEST_SUDO_MODE="+mode, "HOME="+dir)
					cmd.Stdin = ch
					cmd.Stdout, cmd.Stderr = ch, ch.Stderr()
					err = cmd.Run()
					status := uint32(0)
					if err != nil {
						status = 1
					}
					_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{status}))
					serverDone <- err
					return
				}
			}()
			client, err := ssh.Dial("tcp", ln.Addr().String(), &ssh.ClientConfig{User: "test", HostKeyCallback: ssh.FixedHostKey(signer.PublicKey()), Timeout: 5 * time.Second})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			sealed, err := secretcrypt.Seal(password)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			output := filepath.Join(dir, "compose.yaml")
			err = run(ctx, client, Profile{Sudo: true, SudoPassword: sealed}, "test \"$1\" = "+quote(dir)+" || exit 1; umask 077; cat > "+quote(output), "test-token\n")
			if mode == "wrong-password" {
				if err == nil {
					t.Fatal("incorrect sudo password accepted")
				}
				<-serverDone
				if _, err = os.Stat(output); !os.IsNotExist(err) {
					t.Fatal("script executed despite failed sudo")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err = <-serverDone; err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(output)
			if err != nil || string(data) != "test-token\n" {
				t.Fatalf("stdin corrupted: %q, %v", data, err)
			}
		})
	}
}

func TestDeploymentUsesLoginHome(t *testing.T) {
	for _, home := range []string{filepath.Join(t.TempDir(), "login user"), filepath.Join(t.TempDir(), "root")} {
		if err := os.Mkdir(home, 0700); err != nil {
			t.Fatal(err)
		}
		script := "set -eu\n" + deploymentPaths + "\nprintf '%s' \"$enb_target\""
		// The legacy directory guard is asserted statically, so the test need not
		// depend on or access a host's /opt installation.
		script = strings.ReplaceAll(script, "test ! -e /opt/enb/node\n", "")
		script = strings.ReplaceAll(script, "test ! -L /opt/enb/node\n", "")
		cmd := exec.Command("sh", "-c", script, "enb", home)
		cmd.Env = append(os.Environ(), "HOME=/root")
		out, err := cmd.Output()
		physicalHome, resolveErr := filepath.EvalSymlinks(home)
		if resolveErr != nil {
			t.Fatal(resolveErr)
		}
		if err != nil || string(out) != filepath.Join(physicalHome, "enb", "node") {
			t.Fatalf("wrong target %q: %v", out, err)
		}
		if err := os.MkdirAll(filepath.Join(home, "enb", "node"), 0700); err != nil {
			t.Fatal(err)
		}
		if err := exec.Command("sh", "-c", script, "enb", home).Run(); err == nil {
			t.Fatal("existing install accepted")
		}
	}
	if !strings.Contains(deploymentPaths, "/opt/enb/node") {
		t.Fatal("legacy install guard missing")
	}
}

func TestHostIPv6Report(t *testing.T) {
	for _, address := range []string{"2602:f32b::1", "fd00::1", "fe80::1", "", "2602:bad;command"} {
		dir := t.TempDir()
		fakeIP := "#!/bin/sh\nprintf '%s\\n' " + quote("2606:4700:4700::1111 via fe80::1 dev eth0 src "+address) + "\n"
		if err := os.WriteFile(filepath.Join(dir, "ip"), []byte(fakeIP), 0700); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command("sh", "-c", "set -eu; umask 077; "+hostIPv6Report)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"))
		if err := cmd.Run(); err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(filepath.Join(dir, ".env"))
		if err != nil {
			t.Fatal(err)
		}
		want := "ENB_HOST_IPV6=\n"
		if address == "2602:f32b::1" {
			want = "ENB_HOST_IPV6=" + address + "\n"
		}
		if string(b) != want {
			t.Fatalf("unexpected IPv6 report: %q", b)
		}
	}
}
