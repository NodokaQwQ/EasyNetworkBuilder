package virtualnet

import (
	"bytes"
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/nuomiiiii/lite/nodemgt/secretcrypt"
	"golang.org/x/crypto/ssh"
)

func sshAddress(p Profile) string { return net.JoinHostPort(p.Address, strconv.Itoa(p.Port)) }

func connect(ctx context.Context, p Profile, probe bool) (*ssh.Client, string, error) {
	var fingerprint string
	callback := func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fingerprint = ssh.FingerprintSHA256(key)
		if probe {
			return errors.New("fingerprint collected")
		}
		if subtle.ConstantTimeCompare([]byte(fingerprint), []byte(p.Fingerprint)) != 1 {
			return errors.New("SSH host key mismatch")
		}
		return nil
	}
	cfg := &ssh.ClientConfig{User: p.Username, HostKeyCallback: callback, Timeout: 10 * time.Second}
	if !probe {
		if p.AuthType == "password" {
			v, e := secretcrypt.Open(p.Password)
			if e != nil {
				return nil, "", errors.New("credential decryption failed")
			}
			cfg.Auth = []ssh.AuthMethod{ssh.Password(v)}
		} else {
			key, e := secretcrypt.Open(p.PrivateKey)
			if e != nil {
				return nil, "", errors.New("credential decryption failed")
			}
			pass, e := secretcrypt.Open(p.Passphrase)
			if e != nil {
				return nil, "", errors.New("credential decryption failed")
			}
			var signer ssh.Signer
			if pass != "" {
				signer, e = ssh.ParsePrivateKeyWithPassphrase([]byte(key), []byte(pass))
			} else {
				signer, e = ssh.ParsePrivateKey([]byte(key))
			}
			if e != nil {
				return nil, "", errors.New("invalid SSH private key or passphrase")
			}
			cfg.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
		}
	}
	dialer := net.Dialer{Timeout: 10 * time.Second}
	conn, e := dialer.DialContext(ctx, "tcp", sshAddress(p))
	if e != nil {
		return nil, "", errors.New("SSH endpoint unreachable")
	}
	deadline := time.Now().Add(12 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetDeadline(deadline)
	c, ch, req, e := ssh.NewClientConn(conn, sshAddress(p), cfg)
	if e != nil {
		conn.Close()
		if probe && fingerprint != "" {
			return nil, fingerprint, nil
		}
		return nil, "", errors.New("SSH handshake failed: check pinned host key and authentication")
	}
	_ = conn.SetDeadline(time.Time{})
	return ssh.NewClient(c, ch, req), fingerprint, nil
}

func Fingerprint(ctx context.Context, address string, port int) (string, error) {
	if port < 1 || port > 65535 {
		return "", errors.New("invalid SSH port")
	}
	_, fp, e := connect(ctx, Profile{Address: address, Port: port, Username: "enb-host-key-probe"}, true)
	return fp, e
}

func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }

// Remote stdout/stderr are intentionally discarded: failures must not echo credentials or commands.
func run(ctx context.Context, client *ssh.Client, p Profile, script, input string) error {
	s, e := client.NewSession()
	if e != nil {
		return errors.New("SSH session failed")
	}
	defer s.Close()
	s.Stdout = io.Discard
	s.Stderr = io.Discard
	command := "sh -c " + quote(script)
	if p.Sudo {
		password, e := secretcrypt.Open(p.SudoPassword)
		if e != nil {
			return errors.New("sudo credential decryption failed")
		}
		if strings.ContainsAny(password, "\r\n") {
			return errors.New("sudo password cannot contain line breaks")
		}
		if password != "" {
			// Consume the password separately: cached sudo or root must not leave it in
			// the stdin stream containing the token-bearing Compose document.
			command = "sh -c " + quote("IFS= read -r enb_sudo_password; printf '%s\\n' \"$enb_sudo_password\" | sudo -S -p '' -v || exit 1; unset enb_sudo_password; exec sudo -n -- "+command)
			input = password + "\n" + input
		} else {
			command = "sudo -n -- " + command
		}
	}
	s.Stdin = bytes.NewBufferString(input)
	done := make(chan error, 1)
	go func() { done <- s.Run(command) }()
	select {
	case <-ctx.Done():
		client.Close()
		return errors.New("SSH operation timed out")
	case err := <-done:
		if err != nil {
			return errors.New("remote command failed; check Docker Compose availability and sudo permissions")
		}
		return nil
	}
}

func Test(ctx context.Context, p Profile) error {
	c, _, e := connect(ctx, p, false)
	if e != nil {
		return e
	}
	defer c.Close()
	return run(ctx, c, p, "set -eu; test \"$(uname -s)\" = Linux; command -v docker >/dev/null; docker compose version >/dev/null; docker info >/dev/null", "")
}

// Preflight runs before registering a new panel node, avoiding orphan registrations
// for machines that already have an agent or a previous managed installation.
func Preflight(ctx context.Context, p Profile) error {
	c, _, e := connect(ctx, p, false)
	if e != nil {
		return e
	}
	defer c.Close()
	return run(ctx, c, p, `set -eu
test "$(uname -s)" = Linux
case "$(uname -m)" in x86_64|amd64) ;; *) exit 1;; esac
docker compose version >/dev/null
docker info >/dev/null
test ! -e /opt/enb/node
if docker ps -a --format '{{.Names}}' | grep -Eq '(^|[-_])(enb|lite|komari).*agent|enb.*node'; then exit 1; fi
`, "")
}

const NodeImage = "nodokaqwq/enb@sha256:f54d72ae95071ffde78118248e5dce868c8e02ae50682689e318d1ddddc7ae96"

func Compose(token, endpoint string) (string, error) {
	if strings.ContainsAny(token, "\r\n") || token == "" {
		return "", errors.New("invalid node token")
	}
	// JSON quoted scalars are YAML compatible; escape Compose interpolation as well.
	scalar := func(v string) string { return strconv.Quote(strings.ReplaceAll(v, "$", "$$")) }
	return fmt.Sprintf(`services:
  node:
    image: %s
    command: ["--disable-auto-update"]
    restart: unless-stopped
    environment:
      AGENT_ENDPOINT: %s
      AGENT_TOKEN: %s
    volumes:
      - ./nodemgt:/app/nodemgt
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "2"
`, NodeImage, scalar(endpoint), scalar(token)), nil
}

func Deploy(ctx context.Context, p Profile, compose string) error {
	c, _, e := connect(ctx, p, false)
	if e != nil {
		return e
	}
	defer c.Close()
	// Never overwrite any pre-existing deployment, stop proxies, install Docker or change EasyTier.
	// Token-bearing Compose arrives on stdin, not in process arguments.
	script := `set -eu
test "$(uname -s)" = Linux
case "$(uname -m)" in x86_64|amd64) ;; *) exit 1;; esac
docker compose version >/dev/null
docker info >/dev/null
if docker ps -a --format '{{.Names}}' | grep -Eq '(^|[-_])(enb|lite|komari).*agent|enb.*node'; then exit 1; fi
umask 077
mkdir -p /opt/enb
mkdir /opt/enb/node
cd /opt/enb/node
cat > compose.yaml
mkdir nodemgt
if ! docker compose -p enb-managed-node up -d; then
  docker compose -p enb-managed-node stop || true
  exit 1
fi
test -n "$(docker compose -p enb-managed-node ps --status running -q node)"
`
	return run(ctx, c, p, script, compose)
}
