import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync("src/components/admin/shell/useAdminShell.ts", "utf8");
const dialog = readFileSync("src/components/admin/shell/UpdateReleaseDialog.tsx", "utf8");

test("ENB update uses host-approved releases, never the upstream release fetch", () => {
  assert.match(hook, /admin:getENBReleases/);
  assert.doesNotMatch(hook, /fetchGithubReleases|readGithubReleasesCache/);
  assert.match(hook, /latestRelease.enb_hash/);
  assert.match(hook, /version_hash: targetHash/);
});

test("Docker update requires explicit risk acknowledgement", () => {
  assert.match(dialog, /deployment === "docker"/);
  assert.match(dialog, /disabled=\{!confirmed \|\| updatePhase !== "idle"\}/);
  assert.match(dialog, /不是零停机热更新/);
  assert.match(dialog, /数据可能丢失/);
});

test("completion uses persistent task success and resumes running tasks", () => {
  assert.match(hook, /status.last_result.status === "succeeded"/);
  assert.match(hook, /status.last_result.id === taskId/);
  assert.match(hook, /task.status !== "running"/);
  assert.match(hook, /waitForUpdatedService\(task.target_version, task.target_hash, task.id\)/);
  assert.doesNotMatch(hook, /fetch\("\/api\/version"/);
});

test("Git catalog checks expose refresh, timestamps, and failure instead of latest claims", () => {
  assert.match(hook, /check_error/);
  assert.match(hook, /30 \* 60_000/);
  assert.match(hook, /Math.random/);
  assert.match(dialog, /立即检查更新/);
  assert.match(dialog, /不能据此判断已是最新/);
});
