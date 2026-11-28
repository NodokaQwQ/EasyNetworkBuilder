import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/pages/admin/returnRouteServers.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/pages/admin/returnRoute.tsx", import.meta.url), "utf8");

test("按服务器分页并展示全部目标，不在前端按目标拆散服务器", () => {
  assert.match(page, /request\("\/servers\/query"/);
  assert.match(page, /groups\.flatMap\(\(group\) => group\.tasks\)/);
  assert.match(page, /<ReturnRouteServerGroups/);
  assert.match(source, /new Map<string, Task\[]>/);
  assert.match(source, /group\.map\(renderTarget\)/);
});

test("一个服务器任务可添加多个 IP 域名、运营商、预期线路和地址类型", () => {
  assert.match(source, /targets\.map\(\(target, index\)/);
  for (const name of ["target", "carrier", "expected_line", "ip_version", "region"]) {
    assert.ok(source.includes(`target.${name}`));
  }
  assert.match(source, /添加目标/);
  assert.match(source, /移除此目标/);
  assert.match(source, /request\("\/servers\/save"/);
  assert.match(source, /existing_target_ids: existingTargetIDs/);
  assert.match(source, /setExistingTargetIDs\(tasks\.flatMap/);
  assert.match(source, /disabled=\{saving \|\| !client\}/);
});

test("延迟监测默认跟随回程间隔，仅允许指定更短的正整数间隔", () => {
  assert.match(source, /ping_interval: Number\(pingInterval\)/);
  assert.match(source, /min="1" max=\{interval\} step="1"/);
  assert.match(source, /自动创建同节点、同目标 ICMP 监测/);
  assert.match(source, /留空默认跟随回程检测/);
  assert.match(source, /setPingInterval\(first\?\.ping_interval/);
});
