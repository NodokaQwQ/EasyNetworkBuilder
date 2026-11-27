package virtualnet

import (
	"context"
	"fmt"
	"strconv"
)

// The original Compose, token, environment, ports and snapshots stay untouched.
// An explicit override is used on every subsequent managed resume.
func ApplyNodePermissions(ctx context.Context, p Profile, policy Policy) error {
	c, _, err := connect(ctx, p, false)
	if err != nil {
		return err
	}
	defer c.Close()
	return run(ctx, c, p, nodePermissionsScript(policy), "")
}

func nodePermissionsScript(policy Policy) string {
	image := policy.NodeImage
	if image == "" {
		image = NodeImage
	}
	// Revalidate even when called outside the RPC layer.
	if !imageDigest.MatchString(image) {
		return "exit 1"
	}
	override := fmt.Sprintf("services:\n  node:\n    image: %s\n    command: [\"--disable-auto-update\", \"--enable-remote-control=%t\", %s]\n", image, policy.NodeAllowlist() != "none", strconv.Quote("--remote-permissions="+policy.NodeAllowlist()))
	return `set -eu
` + loginDeploymentPaths + `
test -d "$enb_target"
test -f "$enb_target/compose.yaml"
test ! -L "$enb_target/compose.yaml"
test ! -L "$enb_target/.env"
test ! -L "$enb_target/permissions.yaml"
test ! -L "$enb_target/node-version.yaml"
` + managedProjectGuard + `
command -v flock >/dev/null
exec 9< "$enb_parent"
flock -n 9
test ! -L "$enb_parent"
test ! -L "$enb_target"
test -d "$enb_target/nodemgt"
test ! -L "$enb_target/nodemgt"
cd "$enb_target"
test "$(docker compose -p enb-managed-node -f compose.yaml config --services)" = node
` + managedBaseImageGuard() + `
# Only the known deployment command may be replaced. Refuse hand-edited runtime
# arguments rather than silently removing them from an existing installation.
umask 077
enb_config=$(mktemp "$enb_target/.permissions-check.XXXXXXXX")
trap 'rm -f -- "$enb_config"' EXIT
docker compose -p enb-managed-node -f compose.yaml config --format json > "$enb_config"
awk '{config=config $0} END {gsub(/[[:space:]]/, "", config); if (config !~ /"command":\["--disable-auto-update"\]/) exit 1}' "$enb_config"
rm -f -- "$enb_config"
docker image inspect ` + quote(image) + ` >/dev/null 2>&1 || docker pull ` + quote(image) + `
# Fail closed BEFORE replacing configuration: old Agents ignore no permissions.
docker run --rm --network none --read-only ` + quote(image) + ` --help | grep -q -- '--remote-permissions'
umask 077
enb_override=$(mktemp "$enb_target/.permissions.XXXXXXXX")
trap 'rm -f -- "$enb_override"' EXIT
printf '%s' ` + quote(override) + ` > "$enb_override"
docker compose -p enb-managed-node -f compose.yaml -f "$enb_override" config --quiet
test "$(docker compose -p enb-managed-node -f compose.yaml -f "$enb_override" config --services)" = node
mv -- "$enb_override" permissions.yaml
if [ -f node-version.yaml ]; then
  printf 'services:\n  node:\n    image: %s\n' ` + quote(image) + ` > node-version.yaml.tmp
  mv node-version.yaml.tmp node-version.yaml
fi
` + nodeUpdateCompose + `
enb_compose up -d --no-deps --force-recreate node
test -n "$(enb_compose ps --status running -q node)"
`
}
