#!/usr/bin/env python3
"""Local-only image smoke tests. No host data mounts or existing servers."""
import argparse
import json
import subprocess
import urllib.error
import urllib.request
import uuid


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["head", "node"])
    parser.add_argument("image")
    args = parser.parse_args()
    if args.kind == "node":
        help_text = docker("run", "--rm", "--platform", "linux/amd64", "--network", "none", "--read-only", args.image, "--help")
        assert "--remote-permissions" in help_text
        for permissions in ["none", "terminal", "files", "terminal,files,exec,mcp,firewall,protection"]:
            # Configuration is validated before missing endpoint/token; unknown
            # permission must fail at validation rather than start a client.
            result = subprocess.run(["docker", "run", "--rm", "--platform", "linux/amd64", "--network", "none", args.image, "--disable-auto-update", "--interval=0", "--remote-permissions=" + permissions], capture_output=True, text=True, timeout=30)
            assert result.returncode != 0 and "invalid reporting interval" in result.stdout + result.stderr
        result = subprocess.run(["docker", "run", "--rm", "--platform", "linux/amd64", "--network", "none", args.image, "--remote-permissions=untrusted"], capture_output=True, text=True)
        assert result.returncode != 0 and "unknown remote permission" in result.stdout + result.stderr
        print("Node: amd64 image starts, independent permission flag available, invalid policy rejected")
        return
    name = "enb-head-smoke-" + uuid.uuid4().hex[:12]
    try:
        docker("run", "-d", "--name", name, "--platform", "linux/amd64", "-p", "127.0.0.1::28777", args.image, "/app/Lite", "server", "--listen", "0.0.0.0:28777")
        docker("exec", name, "sh", "-c", "i=0; until wget -q -O /dev/null http://127.0.0.1:28777/ping; do i=$((i+1)); test $i -lt 30 || exit 1; sleep 1; done")
        info = json.loads(docker("inspect", name))[0]
        port = info["NetworkSettings"]["Ports"]["28777/tcp"][0]["HostPort"]
        url = "http://127.0.0.1:" + port
        with urllib.request.urlopen(url + "/ping", timeout=10) as response:
            body = response.read()
            assert body == b"pong" or (response.url.endswith("/install") and b"/system-assets/" in body)
        with urllib.request.urlopen(url + "/admin/virtualnet", timeout=10) as response:
            html = response.read().decode()
            assert "/system-assets/" in html
        # First-run installation may gate admin APIs; neither endpoint may
        # disclose policy or permit a terminal to an anonymous browser.
        for endpoint in ["/api/admin/client/host-terminal", "/api/rpc2"]:
            try:
                request = urllib.request.Request(url + endpoint)
                if endpoint.endswith("rpc2"):
                    request = urllib.request.Request(url + endpoint, data=json.dumps({"jsonrpc": "2.0", "id": "smoke", "method": "admin:virtualnet.permissions", "params": {"peer_id": "fixture"}}).encode(), headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(request, timeout=10) as response:
                    result = response.read().decode()
                    assert '"policy"' not in result and '"ticket"' not in result
                    assert "error" in result or "install" in result
            except urllib.error.HTTPError as error:
                assert error.code in [401, 403, 404, 409, 423, 503]
        assert docker("exec", name, "/usr/local/bin/easytier-cli", "--version").startswith("easytier-cli 2.6.4")
        info = json.loads(docker("inspect", name))[0]
        assert info["State"]["Running"] and info["RestartCount"] == 0
        print("Head: local first-run startup/install gate, embedded HTML, anonymous denial, EasyTier CLI and restart count verified")
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    main()
