import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("updater", Path(__file__).with_name("enb-updater.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

OLD = "sha256:" + "a" * 64
NEW = "docker.io/nodokaqwq/enb@sha256:" + "b" * 64


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="enb-updater-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        project = root / "head"
        project.mkdir()
        data = project / "data"
        data.mkdir()
        (data / "lite.db").write_text("old consistent database")
        (project / "compose.yaml").write_text("services: {}")
        self.calls = []
        self.running = True
        self.current_image = OLD
        self.fail_pull = False
        self.fail_new = False
        self.fail_rollback = False
        self.release = {"version": "0.3.0", "hash": "1234567-new", "image": NEW,
                        "platform": "linux/amd64", "channel": "stable",
                        "rollback": "restore-data-v1", "from_versions": ["0.2.1-enb.1"]}
        self.updater = module.Updater({
            "project_dir": str(project), "data_dir": str(data),
            "state_dir": str(root / "state"), "project_name": "enb-head",
            "compose_file": str(project / "compose.yaml"), "service": "head",
            "health_url": "http://127.0.0.1:28777/api/version", "platform": "linux/amd64",
            "release_url": "https://releases.example/head.json", "health_timeout": 0,
            "local_sqlite_layout_confirmed": True,
        }, self.command)
        self.addCleanup(self.updater.lockfile.close)
        self.updater.health = lambda: {"version": "0.2.1-enb.1", "hash": "oldhash1", "enb_update_ready": True}
        self.updater.wait_health = self.check_health
        self.updater.task = {"id": "testtask", "target_version": "0.3.0", "target_hash": "1234567-new",
                             "release": self.release, "status": "running", "stage": "queued"}
        self.sync = patch.object(module.os, "sync")
        self.sync.start()
        self.addCleanup(self.sync.stop)

    def command(self, args):
        self.calls.append(args)
        if args[1] == "pull":
            if self.fail_pull:
                raise RuntimeError("pull failed")
            return ""
        if args[1:3] == ["image", "inspect"]:
            return json.dumps([{"Os": "linux", "Architecture": "amd64", "Id": "sha256:" + "c" * 64}])
        if args[1] == "inspect":
            return json.dumps([{"State": {"Running": self.running}, "Image": self.current_image,
                                "HostConfig": {"Privileged": False}, "Mounts": [
                                    {"Destination": "/app/data", "Type": "bind", "RW": True,
                                     "Source": str(self.updater.data)},
                                    {"Destination": "/run/enb-updater", "Type": "bind", "RW": False}]}])
        if "config" in args:
            return json.dumps({"services": {"head": {"image": OLD}}})
        if "ps" in args:
            return "container-id\n"
        if "stop" in args:
            self.running = False
        if "up" in args:
            self.running = True
            self.current_image = json.loads(self.updater.override.read_text())["services"]["head"]["image"]
            if self.current_image == NEW:
                (self.updater.data / "lite.db").write_text("new migrated database")
        return ""

    def check_health(self, version, version_hash):
        if version == "0.3.0" and self.fail_new:
            raise RuntimeError("new health failed")
        if version != "0.3.0" and self.fail_rollback:
            raise RuntimeError("rollback health failed")

    def test_success_pull_before_stop_and_no_other_services(self):
        self.updater.execute()
        self.assertEqual(self.updater.task["status"], "succeeded")
        self.assertEqual(self.current_image, NEW)
        self.assertEqual((self.updater.state / "testtask/data/lite.db").read_text(), "old consistent database")
        pull = next(i for i, args in enumerate(self.calls) if args[1] == "pull")
        stop = next(i for i, args in enumerate(self.calls) if "stop" in args)
        self.assertLess(pull, stop)
        for args in self.calls:
            self.assertNotIn("down", args)
            if "up" in args:
                self.assertIn("--no-deps", args)
                self.assertEqual(args[-1], "head")

    def test_pull_failure_never_stops_head(self):
        self.fail_pull = True
        self.updater.execute()
        self.assertEqual(self.updater.task["status"], "failed")
        self.assertTrue(self.running)
        self.assertFalse(any("stop" in args for args in self.calls))
        self.assertFalse(self.updater.override.exists())

    def test_failed_health_restores_database_and_keeps_migrated_data(self):
        self.fail_new = True
        self.updater.execute()
        self.assertEqual(self.updater.task["status"], "rolled_back")
        self.assertEqual(self.current_image, OLD)
        self.assertEqual((self.updater.data / "lite.db").read_text(), "old consistent database")
        self.assertEqual((self.updater.data.parent / ".enb-failed-testtask/lite.db").read_text(), "new migrated database")

    def test_failed_rollback_blocks_next_update(self):
        self.fail_new = self.fail_rollback = True
        self.updater.execute()
        self.assertEqual(self.updater.task["status"], "rollback_failed")
        with self.assertRaises(ValueError):
            self.updater.start("0.3.0", "1234567-new")

    def test_backup_failure_restarts_old_without_restoring_partial_copy(self):
        with patch.object(module, "copy_tree", side_effect=OSError("disk full")):
            self.updater.execute()
        self.assertEqual(self.updater.task["status"], "rolled_back")
        self.assertEqual((self.updater.data / "lite.db").read_text(), "old consistent database")

    def test_restart_recovers_interrupted_switch(self):
        def crash(*_):
            raise KeyboardInterrupt()
        self.updater.wait_health = crash
        with self.assertRaises(KeyboardInterrupt):
            self.updater.execute()
        self.updater.wait_health = self.check_health
        self.updater.recover()
        self.assertEqual(self.updater.task["status"], "rolled_back")
        self.assertEqual((self.updater.data / "lite.db").read_text(), "old consistent database")

    def test_restart_before_stop_changes_no_data(self):
        self.updater.recover()
        self.assertEqual(self.updater.task["status"], "failed")
        self.assertEqual(self.calls, [])

    def test_symlink_data_rejected_before_pull(self):
        (self.updater.data / "link").symlink_to("/etc/passwd")
        self.updater.execute()
        self.assertEqual(self.updater.task["status"], "failed")
        self.assertFalse(any(args[1] == "pull" for args in self.calls))

    def test_incompatible_source_rejected(self):
        self.release["from_versions"] = ["0.1.0"]
        self.updater.execute()
        self.assertEqual(self.updater.task["status"], "failed")
        self.assertFalse(any("stop" in args for args in self.calls))

    def test_feed_filters_unapproved_repo_platform_and_channel(self):
        invalid = [dict(self.release, image="evil/image:latest"),
                   dict(self.release, platform="linux/arm64"),
                   dict(self.release, channel="test"), dict(self.release, rollback="none")]
        with patch.object(module, "read_json_url", return_value={"schema": 1, "component":"head", "releases": invalid + [self.release]}):
            self.assertEqual(self.updater.releases(), [self.release])

    def test_lock_prevents_second_process(self):
        with self.assertRaises(BlockingIOError):
            module.Updater(self.updater.config, self.command)

    def test_disk_space_rejected_before_pull(self):
        with patch.object(module.shutil, "disk_usage", return_value=SimpleNamespace(free=0)):
            self.updater.execute()
        self.assertEqual(self.updater.task["status"], "failed")
        self.assertFalse(any("stop" in args for args in self.calls))

    def test_database_readiness_required_before_pull(self):
        self.updater.health = lambda: {"version": "0.2.1-enb.1", "hash": "oldhash1", "enb_update_ready": False}
        self.updater.execute()
        self.assertEqual(self.updater.task["status"], "failed")
        self.assertFalse(any(args[1] == "pull" for args in self.calls))

    def test_running_task_blocks_duplicate_submission(self):
        with self.assertRaises(ValueError):
            self.updater.start("0.3.0", "1234567-new")

    def test_socket_start_only_accepts_feed_release(self):
        self.updater.task = None
        self.updater.releases = lambda: [self.release]
        with self.assertRaises(ValueError):
            self.updater.start("0.3.0", "wronghash")

    def test_non_numeric_target_rejected(self):
        self.release["version"] = "0.2.1-enb.1"
        self.updater.task["target_version"] = "0.2.1-enb.1"
        self.updater.execute()
        self.assertEqual(self.updater.task["status"], "failed")

    def test_public_status_never_returns_config_or_release(self):
        status = self.updater.status()
        self.assertNotIn("release", status["last_result"])
        self.assertNotIn("old_image", status["last_result"])


if __name__ == "__main__":
    unittest.main()
