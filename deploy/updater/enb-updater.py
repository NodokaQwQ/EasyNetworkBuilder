#!/usr/bin/env python3
"""Root-managed ENB Head updater; accepts release IDs, never shell commands."""
import argparse
import fcntl
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import socketserver
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid

IMAGE = re.compile(r"^docker\.io/nodokaqwq/enb@sha256:[0-9a-f]{64}$")
VERSION = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
HASH = re.compile(r"^[A-Za-z0-9._-]{7,100}$")
TERMINAL = {"succeeded", "failed", "rolled_back", "rollback_failed"}


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(".tmp")
    with open(temporary, "w", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def secure_path(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError("paths must be absolute without symlinks")
    return path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ValueError("redirects not allowed for release or readiness URLs")


def read_json_url(url, limit=1024 * 1024):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=20) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError("response too large")
    return json.loads(content)


def copy_tree(source, destination):
    # shutil.copy2 preserves modes/times, but not uid/gid. SQLite data may be
    # owned by a non-root container user; restore must preserve that ownership.
    for path in [Path(source), *Path(source).rglob("*")]:
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError("unsupported snapshot file")
    def copy_file(src, dst):
        info = os.lstat(src)
        if not os.path.isfile(src) or os.path.islink(src):
            raise ValueError("unsupported file in stopped data snapshot")
        shutil.copy2(src, dst)
        os.chown(dst, info.st_uid, info.st_gid)
        return dst
    shutil.copytree(source, destination, copy_function=copy_file)
    for directory in [Path(source), *[p for p in Path(source).rglob("*") if p.is_dir()]]:
        if directory.is_symlink():
            raise ValueError("symlink in stopped data snapshot")
        info = directory.stat()
        os.chown(Path(destination) / directory.relative_to(source), info.st_uid, info.st_gid)


class Updater:
    def __init__(self, config, runner=None):
        self.config = config
        self.project = secure_path(config["project_dir"])
        self.data = secure_path(config["data_dir"])
        self.state = secure_path(config["state_dir"])
        self.compose_file = secure_path(config["compose_file"])
        if not config.get("local_sqlite_layout_confirmed"):
            raise ValueError("operator must confirm the supported local SQLite layout")
        if self.data == self.project or self.data == Path("/"):
            raise ValueError("unsafe data directory")
        if self.state == self.data or self.data in self.state.parents:
            raise ValueError("state must be outside application data")
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", config["project_name"]):
            raise ValueError("invalid Compose project")
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", config["service"]):
            raise ValueError("invalid Compose service")
        self.override = self.project / "enb-update.override.json"
        health = urllib.parse.urlparse(config["health_url"])
        if (health.scheme != "http" or health.hostname not in {"127.0.0.1", "::1"}
                or health.path != "/api/version" or health.username or health.password):
            raise ValueError("health URL must be loopback HTTP /api/version")
        feed = urllib.parse.urlparse(config["release_url"])
        if feed.scheme != "https" or not feed.hostname or feed.username or feed.password:
            raise ValueError("release URL must use HTTPS")
        if config["platform"] not in {"linux/amd64", "linux/arm64"}:
            raise ValueError("unsupported platform")
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.lockfile = (self.state / "updater.lock").open("a")
        try:
            fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            self.lockfile.close()
            raise
        self.runner = runner or self.run
        self.mutex = threading.Lock()
        journal = self.state / "task.json"
        self.task = json.loads(journal.read_text()) if journal.exists() else None

    def run(self, args):
        # Do not expose Docker output: it can contain environment secrets.
        result = subprocess.run(args, cwd=self.project, capture_output=True, timeout=600)
        if result.returncode:
            raise RuntimeError("Docker operation failed; inspect host deployment")
        return result.stdout.decode()

    def compose(self, *args):
        command = ["docker", "compose", "--project-directory", str(self.project),
                   "-p", self.config["project_name"], "-f", str(self.compose_file)]
        if self.override.exists():
            command += ["-f", str(self.override)]
        return self.runner(command + list(args))

    def save(self, status, stage, **fields):
        with self.mutex:
            self.task.update(status=status, stage=stage, updated_at=time.time(), **fields)
            atomic_json(self.state / "task.json", self.task)

    def status(self):
        with self.mutex:
            public = None
            if self.task:
                public = {key: self.task.get(key) for key in
                          ("id", "status", "stage", "target_version", "target_hash", "message")}
            blocked = self.task and self.task["status"] == "rollback_failed"
            return {"deployment": "docker", "supported": not bool(blocked),
                    "reason": "host_recovery_required" if blocked else "", "last_result": public}

    def releases(self):
        feed = read_json_url(self.config["release_url"])
        if feed.get("schema") != 1 or feed.get("component") != "head" or not isinstance(feed.get("releases"), list):
            raise ValueError("invalid ENB feed")
        if len(feed["releases"]) > 200:
            raise ValueError("too many releases")
        releases = []
        seen = set()
        for item in feed["releases"]:
            if (not isinstance(item, dict) or not VERSION.fullmatch(item.get("version", ""))
                    or not HASH.fullmatch(item.get("hash", ""))
                    or not IMAGE.fullmatch(item.get("image", ""))
                    or item.get("platform") != self.config["platform"]
                    or item.get("channel") != "stable"
                    or item.get("rollback") != "restore-data-v1"
                    or not isinstance(item.get("from_versions"), list)
                    or not all(isinstance(v, str) for v in item["from_versions"])):
                continue
            key = (item["version"], item["platform"])
            if key in seen:
                raise ValueError("duplicate release version/platform")
            seen.add(key)
            releases.append(item)
        return sorted(releases, key=lambda r: tuple(int(v) for v in r["version"].split(".")), reverse=True)

    def health(self):
        body = read_json_url(self.config["health_url"], 65536)
        return body.get("data", body)

    def start(self, version, version_hash):
        with self.mutex:
            if self.task and (self.task["status"] not in TERMINAL
                              or self.task["status"] == "rollback_failed"):
                raise ValueError("update already running or host recovery required")
            release = next((r for r in self.releases()
                            if r["version"] == version and r["hash"] == version_hash), None)
            if not release:
                raise ValueError("release not in approved ENB channel")
            self.task = {"id": uuid.uuid4().hex, "target_version": version,
                         "target_hash": version_hash, "release": release,
                         "status": "running", "stage": "queued"}
            atomic_json(self.state / "task.json", self.task)
            result = {"id": self.task["id"], "target_version": version}
            threading.Thread(target=self.execute, daemon=True).start()
            return result

    def inspect(self):
        ids = self.compose("ps", "-a", "-q", self.config["service"]).split()
        if len(ids) != 1:
            raise ValueError("exactly one Head container required")
        return json.loads(self.runner(["docker", "inspect", ids[0]]))[0]

    def preflight(self):
        model = json.loads(self.compose("config", "--format", "json"))
        if model["services"][self.config["service"]].get("build"):
            raise ValueError("Head must use a released image, not Compose build")
        container = self.inspect()
        if not container["State"]["Running"]:
            raise ValueError("Head must be running")
        mounts = container.get("Mounts", [])
        data_mounts = [m for m in mounts if m["Destination"] == "/app/data"]
        if (len(data_mounts) != 1 or data_mounts[0]["Type"] != "bind"
                or data_mounts[0]["Source"] != str(self.data) or not data_mounts[0]["RW"]):
            raise ValueError("configured bind mount at /app/data required")
        if any(m.get("RW") and m["Destination"] != "/app/data" for m in mounts):
            raise ValueError("additional writable mounts not supported")
        if container["HostConfig"].get("Privileged"):
            raise ValueError("privileged Head not supported")
        if not self.data.is_dir() or self.data.is_symlink():
            raise ValueError("invalid data directory")
        size = 0
        for path in self.data.rglob("*"):
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise ValueError("data contains symlinks or special files")
            if path.is_file():
                size += path.stat().st_size
        if shutil.disk_usage(self.state).free < size * 2 + 256 * 1024 * 1024:
            raise ValueError("insufficient backup disk space")
        if shutil.disk_usage(self.data.parent).free < size + 256 * 1024 * 1024:
            raise ValueError("insufficient restore disk space")
        observed = self.health()
        if not observed.get("enb_update_ready"):
            raise ValueError("Head does not confirm supported data layout and database readiness")
        if observed.get("version") not in self.task["release"]["from_versions"]:
            raise ValueError("release does not support this source version")
        current = observed.get("version", "")
        target = self.task["release"]["version"]
        stable = r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$"
        if not re.fullmatch(stable, target):
            raise ValueError("stable target must be an ENB numeric version")
        if re.fullmatch(stable, current) and tuple(map(int, target.split("."))) <= tuple(map(int, current.split("."))):
            raise ValueError("same-version update or downgrade is not allowed")
        old_image = container["Image"]
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", old_image):
            raise ValueError("invalid running image ID")
        self.save("running", "preflight", old_image=old_image, old_version=observed)

    def set_image(self, image):
        atomic_json(self.override, {"services": {self.config["service"]: {"image": image}}})

    def stop(self):
        self.compose("stop", "-t", "30", self.config["service"])
        ids = self.compose("ps", "-a", "-q", self.config["service"]).split()
        if len(ids) > 1:
            raise RuntimeError("multiple Head containers")
        if ids and json.loads(self.runner(["docker", "inspect", ids[0]]))[0]["State"]["Running"]:
            raise RuntimeError("Head still running; refusing live data restore")

    def up(self):
        self.compose("up", "-d", "--no-deps", "--force-recreate", "--pull", "never", self.config["service"])

    def wait_health(self, version, version_hash):
        deadline = time.monotonic() + self.config.get("health_timeout", 120)
        while time.monotonic() < deadline:
            try:
                observed = self.health()
                container = self.inspect()
                expected = self.task["old_image"] if self.task["stage"] == "rolling_back" else self.task.get("target_image_id")
                health = container["State"].get("Health", {}).get("Status", "healthy")
                if (container["State"]["Running"] and health == "healthy"
                        and container["Image"] == expected
                        and observed.get("enb_update_ready")
                        and observed.get("version") == version and observed.get("hash") == version_hash):
                    return
            except Exception:
                pass
            time.sleep(2)
        raise RuntimeError("Head failed readiness/version check")

    def execute(self):
        try:
            self.preflight()
            self.save("running", "pulling")
            image = self.task["release"]["image"]
            self.runner(["docker", "pull", "--platform", self.config["platform"], image])
            info = json.loads(self.runner(["docker", "image", "inspect", image]))[0]
            if info["Os"] + "/" + info["Architecture"] != self.config["platform"]:
                raise ValueError("image platform mismatch")
            self.save("running", "stopping", stopped=True, target_image_id=info["Id"])
            self.stop()
            backup = self.state / self.task["id"]
            backup.mkdir(mode=0o700)
            shutil.copy2(self.compose_file, backup / "compose.original")
            if self.override.exists():
                shutil.copy2(self.override, backup / "override.original")
            self.save("running", "backing_up")
            copy_tree(self.data, backup / "data")
            os.sync()
            self.save("running", "switching", backup_complete=True)
            self.set_image(image)
            self.up()
            self.save("running", "health_check")
            self.wait_health(self.task["target_version"], self.task["target_hash"])
            self.save("succeeded", "complete", message="Head updated; host backup retained")
        except Exception:
            if self.task.get("stopped"):
                self.rollback()
            else:
                self.save("failed", "preflight", message="Update preflight/pull failed; old Head unchanged")

    def rollback(self):
        try:
            self.save("running", "rolling_back")
            self.stop()
            if self.task.get("backup_complete"):
                backup = self.state / self.task["id"]
                restored = self.data.parent / (".enb-restore-" + self.task["id"])
                failed = self.data.parent / (".enb-failed-" + self.task["id"])
                if not self.task.get("restore_ready"):
                    if restored.exists():
                        raise RuntimeError("partial restore requires host recovery")
                    copy_tree(backup / "data", restored)
                    os.sync()
                    self.save("running", "rolling_back", restore_ready=True)
                if not failed.exists():
                    os.rename(self.data, failed)
                if restored.exists():
                    os.rename(restored, self.data)
                if not self.data.is_dir():
                    raise RuntimeError("restore directory missing")
            self.set_image(self.task["old_image"])
            self.up()
            observed = self.task["old_version"]
            self.wait_health(observed["version"], observed["hash"])
            self.save("rolled_back", "complete", message="Previous image and consistent data restored")
        except Exception:
            self.save("rollback_failed", "manual_recovery", message="Host recovery required; backup and failed data retained")

    def recover(self):
        if self.task and self.task["status"] not in TERMINAL:
            if self.task.get("stopped"):
                self.rollback()
            else:
                self.save("failed", "interrupted", message="Interrupted before stopping Head")


class UnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def serve(updater, path, gid):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            try:
                if self.path == "/status":
                    self.respond(200, updater.status())
                elif self.path == "/releases":
                    self.respond(200, updater.releases())
                else:
                    self.respond(404, {"error": "not found"})
            except Exception:
                self.respond(503, {"error": "ENB updater unavailable; inspect host configuration"})

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if self.path != "/start" or length < 1 or length > 4096:
                    self.respond(400, {"error": "invalid request"})
                    return
                self.connection.settimeout(10)
                body = json.loads(self.rfile.read(length))
                self.respond(202, updater.start(body["version"], body["version_hash"]))
            except Exception:
                self.respond(409, {"error": "Update rejected: unavailable release, active task or recovery required"})

        def respond(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    path = Path(path)
    if path.exists():
        if not path.is_socket():
            raise ValueError("refusing to replace non-socket")
        path.unlink()
    with UnixServer(str(path), Handler) as server:
        os.chown(path, 0, gid)
        os.chmod(path, 0o660)
        updater.recover()
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config_path = secure_path(args.config)
    stat = config_path.stat()
    if os.geteuid() != 0 or stat.st_uid != 0 or stat.st_mode & 0o022:
        raise ValueError("updater and configuration must be root-controlled")
    config = json.loads(config_path.read_text())
    # Compose can execute privileged workloads: its directory/configuration must
    # not be writable by the Head or other untrusted local accounts.
    for value in (config["project_dir"], config["compose_file"], config["state_dir"]):
        path = secure_path(value)
        for entry in (path, *path.parents):
            if entry.exists():
                info = entry.stat()
                if info.st_uid != 0 or info.st_mode & 0o022:
                    raise ValueError("deployment and state paths must be root-controlled")
    os.umask(0o077)
    updater = Updater(config)
    serve(updater, config["socket"], config["socket_gid"])


if __name__ == "__main__":
    main()
