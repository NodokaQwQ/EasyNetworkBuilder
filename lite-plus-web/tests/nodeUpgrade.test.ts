import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync("src/pages/admin/NodeUpgrade.tsx", "utf8");
const permissions = readFileSync("src/pages/admin/NodePermissions.tsx", "utf8");
const page = readFileSync("src/pages/admin/virtualnet.tsx", "utf8");

test("managed peers have a separate Node upgrade action", () => {
  assert.match(page, /setPermissionsTab\(5\)/);
  assert.match(page, />升级 Node</);
  assert.match(permissions, /<Tab label="Node 版本升级"/);
  assert.match(permissions, /admin:virtualnet.node.update/);
  assert.match(permissions, /enabled=\{!!saved\?\.node_docker\}/);
});

test("Node upgrade confirms exact image and disruptive snapshot recovery", () => {
  assert.match(ui, /confirmedImage !== target.image/);
  assert.match(ui, /现有连接会断开/);
  assert.match(ui, /本地新增数据可能丢失/);
  assert.match(ui, /不迁移旧/);
  assert.match(ui, /admin:virtualnet.node.releases/);
  assert.match(ui, /admin:virtualnet.jobs/);
  assert.match(ui, /rollback_failed/);
});

test("Node mutating SSH request remains non-replayed HTTP", () => {
  assert.match(permissions, /fetch\("\/api\/rpc2", \{ method: "POST"/);
  assert.doesNotMatch(ui, /call\("admin:virtualnet.node.update"/);
});

test("Node checks dynamic Git feed and offers manual refresh", () => {
  assert.match(ui, /Git 仓库 releases 发布清单/);
  assert.match(ui, /force: forceCheck/);
  assert.match(ui, /forceCheck = false/);
  assert.match(ui, /info.check_error/);
  assert.match(ui, /立即检查 Node 更新/);
});
