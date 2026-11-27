package virtualnet

import (
	"context"
	"errors"
	"github.com/nuomiiiii/lite/pkg/releasefeed"
	"regexp"
)

// Only actually published, reviewed Node images belong here. This is deliberately
// independent of mutable node-latest and of the Head release channel.
type NodeRelease = releasefeed.Release

var updateID = regexp.MustCompile(`^[a-f0-9]{32}$`)

// Separate image-only override: never replace the user's command/permissions.
// POSIX sh function keeps overrides consistently ordered before the command.
const nodeUpdateCompose = `
enb_compose() {
  if [ -f permissions.yaml ]; then
    if [ -f node-version.yaml ]; then docker compose -p enb-managed-node -f compose.yaml -f permissions.yaml -f node-version.yaml "$@";
    else docker compose -p enb-managed-node -f compose.yaml -f permissions.yaml "$@"; fi
  else
    if [ -f node-version.yaml ]; then docker compose -p enb-managed-node -f compose.yaml -f node-version.yaml "$@";
    else docker compose -p enb-managed-node -f compose.yaml "$@"; fi
  fi
}
`

func NodeUpdate(ctx context.Context, p Profile, release NodeRelease, id, action string) error {
	script, err := nodeUpdateScript(release, id, action)
	if err != nil {
		return err
	}
	c, _, err := connect(ctx, p, false)
	if err != nil {
		return err
	}
	defer c.Close()
	return run(ctx, c, p, script, "")
}

func nodeUpdateScript(release NodeRelease, id, action string) (string, error) {
	if !updateID.MatchString(id) {
		return "", errors.New("invalid update transaction")
	}
	if err := release.Validate("node"); err != nil {
		return "", err
	}
	script := "set -eu\numask 077\nenb_update_transaction=yes\n" + loginDeploymentPaths + managedProjectGuard + `
test -d "$enb_target/nodemgt"
for enb_file in compose.yaml .env permissions.yaml node-version.yaml node-version.yaml.tmp nodemgt; do test ! -L "$enb_target/$enb_file"; done
command -v flock >/dev/null
exec 9< "$enb_parent"
flock -n 9
cd "$enb_target"
` + nodeUpdateCompose + `
enb_backup="$enb_target/.enb-update-` + id + `"
enb_marker="$enb_target/.enb-update-active"
test ! -L "$enb_marker"
test ! -L "$enb_backup"
`
	switch action {
	case "prepare":
		script += `test ! -e "$enb_marker"
test ! -e "$enb_backup"
test "$(enb_compose config --services)" = node
` + managedBaseImageGuard() + `
test "$(uname -m)" = x86_64
test -z "$(find nodemgt -type l -print -quit)"
test -z "$(find nodemgt ! -type f ! -type d -print -quit)"
enb_id=$(enb_compose ps --status running -q node)
test -n "$enb_id"
test "$(docker inspect -f '{{range .Mounts}}{{if .RW}}{{.Type}} {{.Source}} {{.Destination}}{{println}}{{end}}{{end}}' "$enb_id")" = "bind $enb_target/nodemgt /app/nodemgt"
enb_old=$(docker inspect -f '{{.Image}}' "$enb_id")
case "$enb_old" in sha256:*) ;; *) exit 1;; esac
docker pull ` + quote(release.Image) + `
test "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' ` + quote(release.Image) + `)" = linux/amd64
docker run --rm --network none --read-only ` + quote(release.Image) + ` --help | grep -q -- '--remote-permissions'
enb_size=$(du -sk nodemgt | awk '{print $1}')
enb_free=$(df -Pk . | awk 'END {print $4}')
test "$enb_free" -gt "$((enb_size * 3 + 262144))"
mkdir "$enb_backup"
printf 'services:\n  node:\n    image: %s\n' "$enb_old" > "$enb_backup/old-image.yaml"
if [ -f node-version.yaml ]; then cp -p node-version.yaml "$enb_backup/version.original"; fi
cp -p compose.yaml "$enb_backup/compose.original"
if [ -f .env ]; then cp -p .env "$enb_backup/env.original"; fi
if [ -f permissions.yaml ]; then cp -p permissions.yaml "$enb_backup/permissions.original"; fi
printf '%s' ` + quote(id) + ` > "$enb_marker"
sync
enb_compose stop -t 30 node
test "$(docker inspect -f '{{.State.Running}}' "$enb_id")" = false
cp -a nodemgt "$enb_backup/nodemgt"
sync
touch "$enb_backup/complete"
sync
printf 'services:\n  node:\n    image: %s\n' ` + quote(release.Image) + ` > node-version.yaml.tmp
mv node-version.yaml.tmp node-version.yaml
enb_compose up -d --no-deps --force-recreate --pull never node
test -n "$(enb_compose ps --status running -q node)"
`
	case "rollback":
		script += `if [ ! -e "$enb_marker" ]; then exit 0; fi
test "$(cat "$enb_marker")" = ` + quote(id) + `
test -f "$enb_backup/old-image.yaml"
enb_compose stop -t 30 node
test -z "$(enb_compose ps --status running -q node)"
if [ -f "$enb_backup/complete" ]; then
  test ! -e "$enb_backup/failed-nodemgt"
  mv nodemgt "$enb_backup/failed-nodemgt"
  cp -a "$enb_backup/nodemgt" nodemgt
fi
cp -p "$enb_backup/old-image.yaml" node-version.yaml
enb_compose up -d --no-deps --force-recreate --pull never node
test -n "$(enb_compose ps --status running -q node)"
`
	case "commit":
		script += `test "$(cat "$enb_marker")" = ` + quote(id) + `
enb_id=$(enb_compose ps --status running -q node)
test -n "$enb_id"
test "$(docker inspect -f '{{.Image}}' "$enb_id")" = "$(docker image inspect -f '{{.Id}}' ` + quote(release.Image) + `)"
mv "$enb_marker" "$enb_backup/committed"
sync
`
	case "finish_rollback":
		script += `if [ ! -e "$enb_marker" ]; then exit 0; fi
test "$(cat "$enb_marker")" = ` + quote(id) + `
mv "$enb_marker" "$enb_backup/rolled-back"
sync
`
	default:
		return "", errors.New("invalid update action")
	}
	return script, nil
}
