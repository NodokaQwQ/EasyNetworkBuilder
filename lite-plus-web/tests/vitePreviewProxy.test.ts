import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public preview proxy selects HTTPS transport without disabling certificate validation", () => {
  const source = readFileSync("vite.config.ts", "utf8");
  assert.match(source, /import \* as https from "https"/);
  assert.match(source, /target\.protocol === "https:" \? https : http/);
  assert.match(source, /transport\.request\(/);
  assert.match(source, /protocol: target\.protocol/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false|secure:\s*false/);
});
