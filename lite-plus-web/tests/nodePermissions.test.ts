import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/pages/admin/NodePermissions.tsx", import.meta.url), "utf8");
const terminal = readFileSync(new URL("../src/pages/admin/HostTerminal.tsx", import.meta.url), "utf8");
test("permission editor independently authorizes Node and host features", () => {
  for (const key of ["node_terminal", "node_files", "node_exec", "node_mcp", "host_terminal", "host_files", "host_exec", "node_docker"]) assert.ok(source.includes(`"${key}"`));
  assert.match(source, /!confirmed/);
  assert.match(source, /apply_node: applyNode/);
  assert.match(source, /revision/);
  assert.match(source, /remote\/authorize/);
  assert.match(source, /confirmAdminPasskey/);
});
test("mutating host requests use one HTTP attempt without automatic websocket replay", () => {
  const section = source.slice(source.indexOf("async function authorizedCall"), source.indexOf("async function host"));
  assert.match(section, /fetch\("\/api\/rpc2"/);
  assert.doesNotMatch(section, /await call\(/);
  assert.match(section, /next_grant/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
test("SSH terminal tickets stay out of URLs and stdin is gated on readiness", () => {
  assert.match(terminal, /JSON.stringify\(\{ ticket \}\)/);
  assert.doesNotMatch(terminal, /ticket=/);
  assert.match(terminal, /disableStdin: true/);
  assert.match(terminal, /message.ready/);
  assert.match(terminal, /ws.close\(\)/);
});
test("all locales explain host permissions, overlap and disruption", () => {
  for (const locale of ["zh_CN", "zh_TW", "en", "ja_JP"]) {
    const data = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), "utf8"));
    for (const key of ["boundary", "apply_notice", "terminal_notice", "files_notice", "docker_notice", "image_hint", "confirm"]) assert.ok(data.hostctl[key], `${locale}.${key}`);
    assert.match(data.hostctl.boundary, /root/);
    assert.match(data.hostctl.files_notice, /8 MiB/);
  }
});
