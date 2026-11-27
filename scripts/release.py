#!/usr/bin/env python3
"""Prepare, build, push and record ENB releases. No implicit push/deploy."""
import argparse
import hashlib
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO = "docker.io/nodokaqwq/enb"
VERSION = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
HASH = re.compile(r"^[A-Za-z0-9._-]{7,100}$")
EASYTIER = "easytier/easytier@sha256:387f48e84d4ef0896ef4c1d9be03876535a59f0ebdf8251adf581ea39b950f20"


def command(args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def version_tuple(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise ValueError("version must be numeric MAJOR.MINOR.PATCH")
    parts = tuple(map(int, value.split(".")))
    if max(parts) > 2**32 - 1:
        raise ValueError("version component too large")
    return parts


def load(component):
    path = ROOT / "releases" / f"{component}-stable.json"
    return path, json.loads(path.read_text())


def validate(catalog, component):
    if catalog.get("schema") != 1 or catalog.get("component") != component or not isinstance(catalog.get("releases"), list):
        raise ValueError("invalid release catalog")
    seen = set()
    for release in catalog["releases"]:
        version_tuple(release["version"])
        key = (release["version"], release["platform"])
        if key in seen:
            raise ValueError("duplicate version/platform")
        seen.add(key)
        if (release["platform"] != "linux/amd64" or release["channel"] != "stable"
                or not HASH.fullmatch(release["hash"])
                or not release["image"].startswith(REPO + "@")
                or not DIGEST.fullmatch(release["image"].split("@")[-1])
                or release["rollback"] != ("restore-data-v1" if component == "head" else "restore-nodemgt-v1")
                or not release["from_versions"] or not all(isinstance(v, str) and 0 < len(v) <= 100 for v in release["from_versions"])):
            raise ValueError("invalid release metadata")
        datetime.fromisoformat(release["published_at"].replace("Z", "+00:00"))
        if component == "node":
            version_tuple(release["min_head"])


def write(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("validate")
    for action in ("build", "push", "record"):
        item = sub.add_parser(action)
        item.add_argument("component", choices=["head", "node"])
        item.add_argument("--hash", help="Exact build identifier; build requires clean Git unless explicitly overridden")
        if action == "build":
            item.add_argument("--allow-dirty", action="store_true")
        if action == "record":
            item.add_argument("--digest", required=True)
            item.add_argument("--from-version", action="append", required=True)
            item.add_argument("--notes", type=Path, required=True)
            item.add_argument("--min-head", default="0.0.1")
            item.add_argument("--verified", action="store_true", help="Operator attests image, migrations and rollback have passed isolated acceptance")
    args = parser.parse_args()
    versions = json.loads((ROOT / "releases/versions.json").read_text())
    for component in ("head", "node"):
        version_tuple(versions[component])
        validate(load(component)[1], component)
    if args.action == "validate":
        print("ENB release catalogs valid")
        return
    version = versions[args.component]
    tag = f"{REPO}:{args.component}-v{version}"
    if args.action == "build":
        dirty = bool(command(["git", "status", "--porcelain"]))
        if dirty and not args.allow_dirty:
            raise ValueError("working tree is dirty; commit/review first (or explicit --allow-dirty with --hash for tests)")
        revision = args.hash or command(["git", "rev-parse", "HEAD"])
        if dirty and not args.hash:
            raise ValueError("dirty test builds require an explicit non-release --hash")
        if not HASH.fullmatch(revision):
            raise ValueError("invalid build hash")
        dockerfile = "Dockerfile" if args.component == "head" else "Node.Dockerfile"
        cmd = ["docker", "buildx", "build", "--platform", "linux/amd64", "--load", "-f", f"deploy/easytier/{dockerfile}",
               "--build-arg", f"ENB_VERSION={version}", "--build-arg", f"ENB_REVISION={revision}", "-t", tag]
        if args.component == "head":
            cmd += ["--build-arg", f"EASYTIER_IMAGE={EASYTIER}"]
        subprocess.run(cmd + ["."], cwd=ROOT, check=True)
        print(f"Built {tag}; hash={revision}. Not pushed, not added to feed.")
    elif args.action == "push":
        # A separate explicit action. Never move latest or publish a feed here.
        if command(["git", "status", "--porcelain"]):
            raise ValueError("refusing release push from a dirty working tree")
        _, catalog = load(args.component)
        if any(r["version"] == version for r in catalog["releases"]):
            raise ValueError("version already published; bump versions.json")
        labels = json.loads(command(["docker", "image", "inspect", "--format", "{{json .Config.Labels}}", tag])) or {}
        if (labels.get("org.opencontainers.image.version") != version
                or labels.get("io.enb.component") != args.component
                or labels.get("org.opencontainers.image.revision") != command(["git", "rev-parse", "HEAD"])):
            raise ValueError("local image labels must match component/version and current clean source commit")
        # Fail closed on registry/network errors. Only a definite absent tag
        # permits publishing, otherwise an existing release could be overwritten.
        check = subprocess.run(["docker", "buildx", "imagetools", "inspect", tag], cwd=ROOT, capture_output=True, text=True)
        if check.returncode == 0:
            raise ValueError("remote version tag already exists; do not overwrite")
        if "manifest unknown" not in check.stderr.lower() and "not found" not in check.stderr.lower():
            raise ValueError("could not establish remote tag absence; inspect registry access")
        subprocess.run(["docker", "push", tag], cwd=ROOT, check=True)
        subprocess.run(["docker", "buildx", "imagetools", "inspect", tag], cwd=ROOT, check=True)
        print("Copy the verified remote digest into record after acceptance. latest unchanged.")
    elif args.action == "record":
        if not args.verified or not args.hash or not HASH.fullmatch(args.hash) or not DIGEST.fullmatch(args.digest):
            raise ValueError("record requires --verified, exact --hash and immutable --digest")
        path, catalog = load(args.component)
        if any(version_tuple(r["version"]) >= version_tuple(version) for r in catalog["releases"]):
            raise ValueError("bump versions.json first; released versions cannot be overwritten")
        # Require the immutable version tag to resolve to the supplied digest.
        raw_bytes = subprocess.check_output(["docker", "buildx", "imagetools", "inspect", "--raw", tag], cwd=ROOT)
        if "sha256:" + hashlib.sha256(raw_bytes).hexdigest() != args.digest:
            raise ValueError("remote version tag does not match supplied digest")
        release = {"version": version, "hash": args.hash, "image": REPO + "@" + args.digest,
                   "platform": "linux/amd64", "channel": "stable",
                   "rollback": "restore-data-v1" if args.component == "head" else "restore-nodemgt-v1",
                   "from_versions": args.from_version, "published_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                   "notes": args.notes.read_text()}
        if args.component == "node":
            release["min_head"] = args.min_head
        catalog["releases"].insert(0, release)
        validate(catalog, args.component)
        write(path, catalog)
        print(f"Recorded {path.relative_to(ROOT)}. Review and commit/push the catalog to publish discovery. No Git push performed.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
