import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sidebar places virtual network between dashboard and servers", () => {
  const config = JSON.parse(readFileSync("src/config/menuConfig.json", "utf8"));
  assert.deepEqual(config.menu.slice(0, 3).map((item: { path: string }) => item.path),
    ["/admin", "/admin/virtualnet", "/admin/servers"]);
});

test("sidebar GitHub link points to ENB repository", () => {
  const source = readFileSync("src/components/admin/shell/useAdminShell.ts", "utf8");
  assert.match(source, /const currentReleaseURL = "https:\/\/github\.com\/NodokaQwQ\/EasyNetworkBuilder"/);
});
