package virtualnet

import (
	"bytes"
	"context"
	"crypto/rand"
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
	var hostKeyMismatch bool
	callback := func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fingerprint = ssh.FingerprintSHA256(key)
		if probe {
			return errors.New("fingerprint collected")
		}
		if subtle.ConstantTimeCompare([]byte(fingerprint), []byte(p.Fingerprint)) != 1 {
			hostKeyMismatch = true
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
		return nil, "", classifyHandshakeError(ctx, e, hostKeyMismatch)
	}
	_ = conn.SetDeadline(time.Time{})
	return ssh.NewClient(c, ch, req), fingerprint, nil
}

// Never return raw SSH errors: the remote server controls parts of their text.
func classifyHandshakeError(ctx context.Context, err error, hostKeyMismatch bool) error {
	if hostKeyMismatch {
		return errors.New("SSH host key mismatch; independently verify the host fingerprint before saving again")
	}
	var networkError net.Error
	if ctx.Err() != nil || (errors.As(err, &networkError) && networkError.Timeout()) {
		return errors.New("SSH handshake timed out; check the SSH port and network reachability")
	}
	if strings.Contains(err.Error(), "ssh: unable to authenticate") {
		return errors.New("SSH authentication failed; check username, credentials and whether this account permits SSH login")
	}
	return errors.New("SSH handshake failed; check that this port serves SSH and supports compatible algorithms")
}

func Fingerprint(ctx context.Context, address string, port int) (string, error) {
	if port < 1 || port > 65535 {
		return "", errors.New("invalid SSH port")
	}
	_, fp, e := connect(ctx, Profile{Address: address, Port: port, Username: "enb-host-key-probe"}, true)
	return fp, e
}

func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }

type remoteExitError struct{ code int }

func (e remoteExitError) Error() string {
	return "remote command failed; check Docker Compose availability, installation ownership and sudo permissions"
}

// Remote stdout/stderr are intentionally discarded: failures must not echo credentials or commands.
func run(ctx context.Context, client *ssh.Client, p Profile, script, input string) error {
	s, e := client.NewSession()
	if e != nil {
		return errors.New("SSH session failed")
	}
	defer s.Close()
	s.Stdout = io.Discard
	s.Stderr = io.Discard
	// Expand HOME in the original login shell, before sudo resets it to /root.
	command := "sh -c " + quote(script) + " enb \"$HOME\""
	if p.Sudo {
		password, e := secretcrypt.Open(p.SudoPassword)
		if e != nil {
			return errors.New("sudo credential decryption failed")
		}
		if strings.ContainsAny(password, "\r\n") {
			return errors.New("sudo password cannot contain line breaks")
		}
		if password != "" {
			// One sudo invocation: -v then exec -n breaks ppid-scoped timestamps
			// on non-TTY SSH, and also fails with timestamp_timeout=0.
			// Sudo may consume the password (authentication) or leave it (root,
			// NOPASSWD, cached credentials). The privileged wrapper consumes at
			// most two framing lines before giving only the payload to the script.
			marker := "ENB-SUDO-" + rand.Text()
			wrapper := "IFS= read -r enb_frame || exit 1; " +
				"if [ \"$enb_frame\" != " + quote(marker) + " ]; then IFS= read -r enb_frame || exit 1; fi; " +
				"test \"$enb_frame\" = " + quote(marker) + " || exit 1; unset enb_frame; exec sh -c " + quote(script) + " enb \"$1\""
			command = "sudo -S -p '' -- sh -c " + quote(wrapper) + " enb \"$HOME\""
			input = password + "\n" + marker + "\n" + input
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
			var exit *ssh.ExitError
			if errors.As(err, &exit) {
				if exit.ExitStatus() == 72 {
					return errors.New("could not detect host uplink NICs; check iproute2, physical default-route interfaces and README before deployment")
				}
				return remoteExitError{exit.ExitStatus()}
			}
			return errors.New("remote command failed; check Docker Compose availability and sudo permissions")
		}
		return nil
	}
}

// The positional argument is resolved by the unprivileged SSH login shell.
// Keep the old path guard to avoid duplicating installations made by earlier releases.
const loginDeploymentPaths = `
case "$1" in /*) ;; *) exit 1;; esac
test -d "$1"
enb_home=$(cd -P "$1" && pwd)
test "$enb_home" != /
enb_parent="$enb_home/enb"
enb_target="$enb_parent/node"
test ! -L "$enb_parent"
test ! -L "$enb_target"
test ! -e /opt/enb/node
test ! -L /opt/enb/node
`

const deploymentPaths = loginDeploymentPaths + `test ! -e "$enb_target"
`

// Only this app's fixed Compose project, with containers belonging to this exact
// working directory, is eligible for automatic replacement. Never use old YAML
// to down a project: it can reference unrelated project names or external files.
const managedProjectGuard = `
for enb_id in $(docker ps -aq --filter label=com.docker.compose.project); do
  enb_dir=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$enb_id")
  enb_project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$enb_id")
  if [ "$enb_dir" = "$enb_target" ] && [ "$enb_project" != enb-managed-node ]; then exit 1; fi
done
for enb_id in $(docker ps -aq --filter label=com.docker.compose.project=enb-managed-node); do
  test "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$enb_id")" = "$enb_target"
done
if docker ps -a --format '{{.Names}} {{.Label "com.docker.compose.project"}}' | grep -Ev ' enb-managed-node$' | grep -Eq '(^|[-_])(enb|lite|komari).*agent|enb.*node'; then exit 1; fi
`

type Installation struct {
	Directory bool `json:"directory"`
	Compose   bool `json:"compose"`
	Running   bool `json:"running"`
}

func (i Installation) Existing() bool { return i.Directory || i.Compose || i.Running }

func InspectInstallation(ctx context.Context, p Profile) (Installation, error) {
	c, _, err := connect(ctx, p, false)
	if err != nil {
		return Installation{}, err
	}
	defer c.Close()
	err = run(ctx, c, p, "set -eu\n"+loginDeploymentPaths+`
test "$(uname -s)" = Linux
case "$(uname -m)" in x86_64|amd64) ;; *) exit 1;; esac
docker compose version >/dev/null
docker info >/dev/null
`+managedProjectGuard+`
enb_status=64
if [ -e "$enb_target" ]; then test -d "$enb_target"; enb_status=$((enb_status+1)); fi
if [ -e "$enb_target/compose.yaml" ]; then test ! -L "$enb_target/compose.yaml"; enb_status=$((enb_status+2)); fi
if [ ! -e "$enb_target/compose.yaml" ] && [ -n "$(docker ps -aq --filter label=com.docker.compose.project=enb-managed-node)" ]; then enb_status=$((enb_status+2)); fi
if [ -n "$(docker ps -q --filter label=com.docker.compose.project=enb-managed-node)" ]; then enb_status=$((enb_status+4)); fi
exit "$enb_status"
`, "")
	var exit remoteExitError
	if !errors.As(err, &exit) || exit.code < 64 || exit.code > 71 {
		if err == nil {
			err = errors.New("invalid installation inspection result")
		}
		return Installation{}, err
	}
	flags := exit.code - 64
	return Installation{flags&1 != 0, flags&2 != 0, flags&4 != 0}, nil
}

func Test(ctx context.Context, p Profile) error {
	c, _, e := connect(ctx, p, false)
	if e != nil {
		return e
	}
	defer c.Close()
	return run(ctx, c, p, "set -eu; test \"$(uname -s)\" = Linux; command -v docker >/dev/null; docker compose version >/dev/null; docker info >/dev/null", "")
}

// Preflight is the non-overwriting compatibility check. Deployment uses the
// richer inspection result and an explicit, session-bound confirmation.
func Preflight(ctx context.Context, p Profile) error {
	c, _, e := connect(ctx, p, false)
	if e != nil {
		return e
	}
	defer c.Close()
	return run(ctx, c, p, `set -eu
`+deploymentPaths+`
test "$(uname -s)" = Linux
case "$(uname -m)" in x86_64|amd64) ;; *) exit 1;; esac
docker compose version >/dev/null
docker info >/dev/null
if docker ps -a --format '{{.Names}}' | grep -Eq '(^|[-_])(enb|lite|komari).*agent|enb.*node'; then exit 1; fi
`, "")
}

const NodeImage = "nodokaqwq/enb@sha256:f54d72ae95071ffde78118248e5dce868c8e02ae50682689e318d1ddddc7ae96"

// Only the host's default-route public IPv6 is advertised, not overlay/bridge IPs.
const hostIPv6Report = `
enb_ipv6=""
if command -v ip >/dev/null 2>&1; then
  enb_ipv6=$(ip -6 route get 2606:4700:4700::1111 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src") {print $(i+1); exit}}' || true)
fi
case "$enb_ipv6" in 2*:*|3*:*) ;; *) enb_ipv6="";; esac
case "$enb_ipv6" in *[!0-9a-fA-F:]*) enb_ipv6="";; esac
printf 'ENB_HOST_IPV6=%s\n' "$enb_ipv6" > .env
`

// Use only device-backed default-route NICs. Overlay/bridge/tunnel defaults,
// bonds and VLANs need an explicit operator choice rather than double counting
// or silently measuring the overlay. Run in staging before touching old data.
const hostNICReport = `
command -v ip >/dev/null 2>&1 || exit 72
enb_nics=$({ ip -o -4 route show default; ip -o -6 route show default; } 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="dev") print $(i+1)}' | LC_ALL=C sort -u)
test -n "$enb_nics" || exit 72
enb_include=""
for enb_nic in $enb_nics; do
  case "$enb_nic" in lo|docker*|br-*|veth*|tun*|tap*|tailscale*|wg*|zt*|easytier*) exit 72;; esac
  case "$enb_nic" in *[!a-zA-Z0-9_.:-]*) exit 72;; esac
  test -e "/sys/class/net/$enb_nic/device" || exit 72
  enb_include="${enb_include:+$enb_include,}$enb_nic"
done
printf 'ENB_HOST_NICS=%s\n' "$enb_include" >> .env
`

func Compose(token string, settings Settings) (string, error) {
	if strings.ContainsAny(token, "\r\n") || token == "" {
		return "", errors.New("invalid node token")
	}
	// JSON quoted scalars are YAML compatible; escape Compose interpolation as well.
	scalar := func(v string) string { return strconv.Quote(strings.ReplaceAll(v, "$", "$$")) }
	endpoint, err := settings.Endpoint()
	if err != nil {
		return "", err
	}
	mapping, err := settings.HostMapping()
	if err != nil {
		return "", err
	}
	extraHosts := ""
	if mapping != "" {
		extraHosts = "    extra_hosts:\n      - " + scalar(mapping) + "\n"
	}
	return fmt.Sprintf(`services:
  node:
    image: %s
    command: ["--disable-auto-update"]
    restart: unless-stopped
    network_mode: host
%s    environment:
      AGENT_ENDPOINT: %s
      AGENT_TOKEN: %s
      AGENT_CUSTOM_IPV6: "${ENB_HOST_IPV6:-}"
      AGENT_INCLUDE_NICS: "${ENB_HOST_NICS:?host uplink NICs must be configured}"
    volumes:
      - ./nodemgt:/app/nodemgt
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "2"
`, NodeImage, extraHosts, scalar(endpoint), scalar(token)), nil
}

func Deploy(ctx context.Context, p Profile, compose string, overwrite bool) error {
	c, _, e := connect(ctx, p, false)
	if e != nil {
		return e
	}
	defer c.Close()
	return run(ctx, c, p, deploymentScript(overwrite), compose)
}

func deploymentScript(overwrite bool) string {
	// Only an explicitly confirmed managed installation may be replaced.
	// Token-bearing Compose arrives on stdin, not in process arguments.
	paths := deploymentPaths
	if overwrite {
		paths = loginDeploymentPaths
	} else {
		paths += `test -z "$(docker ps -aq --filter label=com.docker.compose.project=enb-managed-node)"
`
	}
	script := `set -eu
` + paths + `
test "$(uname -s)" = Linux
case "$(uname -m)" in x86_64|amd64) ;; *) exit 1;; esac
docker compose version >/dev/null
docker info >/dev/null
` + managedProjectGuard + `
umask 077
mkdir -p "$enb_parent"
command -v flock >/dev/null
exec 9< "$enb_parent"
flock -n 9
test ! -L "$enb_parent"
test ! -L "$enb_target"
enb_stage=$(mktemp -d "$enb_parent/.node-install.XXXXXXXX")
trap 'rm -rf -- "$enb_stage"' EXIT
cat > "$enb_stage/compose.yaml"
(cd "$enb_stage"
` + hostIPv6Report + hostNICReport + `
)
docker compose -p enb-managed-node -f "$enb_stage/compose.yaml" config --quiet
docker compose -p enb-managed-node -f "$enb_stage/compose.yaml" pull
`
	if overwrite {
		script += `
# Validate ownership again immediately before the destructive operation.
` + managedProjectGuard + `
test ! -L "$enb_parent"
test ! -L "$enb_target"
# Reject mountpoints so replacement cannot recurse into a mounted filesystem.
if [ -e "$enb_target" ]; then
  command -v mountpoint >/dev/null
  if mountpoint -q "$enb_target"; then exit 1; fi
  find "$enb_target" -type d -exec mountpoint -q '{}' \; -print > "$enb_stage/mountpoints"
  test ! -s "$enb_stage/mountpoints"
fi
docker compose -p enb-managed-node -f "$enb_stage/compose.yaml" down --remove-orphans
test ! -L "$enb_parent"
test ! -L "$enb_target"
if [ -e "$enb_target" ]; then
  rm -rf --one-file-system -- "$enb_target"
fi
`
	}
	script += `
test ! -e "$enb_target"
mkdir "$enb_target"
mv "$enb_stage/compose.yaml" "$enb_target/compose.yaml"
mv "$enb_stage/.env" "$enb_target/.env"
cd "$enb_target"
mkdir nodemgt
if ! docker compose -p enb-managed-node up -d; then
  docker compose -p enb-managed-node stop || true
  exit 1
fi
test -n "$(docker compose -p enb-managed-node ps --status running -q node)"
`
	return script
}

// Lifecycle never removes or rewrites files in the installation directory.
// Pause uses our minimal manifest (not old YAML) to down only the fixed project.
// Resume uses the original Compose/environment, retaining its token and mounts.
func Lifecycle(ctx context.Context, p Profile, resume bool) error {
	c, _, err := connect(ctx, p, false)
	if err != nil {
		return err
	}
	defer c.Close()
	return run(ctx, c, p, lifecycleScript(resume), "services:\n  node:\n    image: "+NodeImage+"\n")
}

func lifecycleScript(resume bool) string {
	script := "set -eu\n" + loginDeploymentPaths + `
test "$(uname -s)" = Linux
docker compose version >/dev/null
docker info >/dev/null
test -d "$enb_target"
test -f "$enb_target/compose.yaml"
test ! -L "$enb_target/compose.yaml"
test ! -L "$enb_target/.env"
` + managedProjectGuard + `
command -v flock >/dev/null
exec 9< "$enb_parent"
flock -n 9
test ! -L "$enb_parent"
test ! -L "$enb_target"
cd "$enb_target"
test -d nodemgt
test ! -L nodemgt
`
	if resume {
		script += `
# Keep lifecycle scoped to the known single-service ENB Node installation.
test "$(docker compose -p enb-managed-node -f compose.yaml config --services)" = node
test "$(docker compose -p enb-managed-node -f compose.yaml config --images)" = ` + quote(NodeImage) + `
docker compose -p enb-managed-node -f compose.yaml config --quiet
docker compose -p enb-managed-node -f compose.yaml pull node
docker compose -p enb-managed-node -f compose.yaml up -d --no-deps node
test -n "$(docker compose -p enb-managed-node -f compose.yaml ps --status running -q node)"
`
	} else {
		script += `
enb_manifest=$(mktemp)
trap 'rm -f -- "$enb_manifest"' EXIT
umask 077
cat > "$enb_manifest"
docker compose -p enb-managed-node -f "$enb_manifest" down --remove-orphans
test -z "$(docker ps -aq --filter label=com.docker.compose.project=enb-managed-node)"
`
	}
	return script
}
