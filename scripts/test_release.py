import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("release.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.release = {"version": "0.0.1", "hash": "abcdef123", "image": module.REPO + "@sha256:" + "a" * 64,
                        "platform": "linux/amd64", "channel": "stable", "rollback": "restore-nodemgt-v1",
                        "from_versions": ["0.2.1-enb-test"], "min_head": "0.0.1", "notes": "test",
                        "published_at": "2026-11-27T00:00:00Z"}

    def test_repo_catalogs_validate(self):
        for component in ("head", "node"):
            module.validate(module.load(component)[1], component)

    def test_reject_invalid_metadata(self):
        for field, value in [("image", module.REPO + ":node-latest"), ("platform", "linux/arm64"),
                             ("version", "v0.0.1"), ("hash", "bad"), ("from_versions", []),
                             ("min_head", "unknown"), ("rollback", "none"), ("published_at", "invalid")]:
            with self.subTest(field=field):
                release = copy.deepcopy(self.release)
                release[field] = value
                with self.assertRaises(ValueError):
                    module.validate({"schema": 1, "component": "node", "releases": [release]}, "node")

    def test_no_duplicate_version(self):
        with self.assertRaises(ValueError):
            module.validate({"schema": 1, "component": "node", "releases": [self.release, self.release]}, "node")

    def test_version_bounds_and_order(self):
        self.assertGreater(module.version_tuple("0.0.10"), module.version_tuple("0.0.2"))
        for value in ["00.0.1", "0.0.1-test", "4294967296.0.0"]:
            with self.assertRaises(ValueError):
                module.version_tuple(value)


if __name__ == "__main__":
    unittest.main()
