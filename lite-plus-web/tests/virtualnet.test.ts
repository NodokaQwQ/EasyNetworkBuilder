import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { virtualnetErrorKey } from "../src/utils/virtualnet.ts";

const source = readFileSync(new URL("../src/pages/admin/virtualnet.tsx", import.meta.url), "utf8");

test("virtual network requires actual credentials, not just a retained Node association", () => {
  assert.match(source, /disabled=\{busy \|\| !profile\?\.has_credentials\}/);
  assert.match(source, /disabled=\{busy \|\| !profile\?\.has_credentials \|\| !settings\?\.control_url\}/);
  assert.match(source, /setVerified\(false\)/);
  assert.match(source, /disabled=\{busy \|\| !verified\}/);
});

test("deployment settings have a persistent RPC editor and block installation until configured", () => {
  assert.match(source, /admin:virtualnet.settings.save/);
  assert.match(source, /admin:virtualnet.settings/);
  assert.match(source, /settingsForm.control_url/);
  assert.match(source, /settingsForm.control_ip/);
  assert.match(source, /virtualnet.control_missing/);
  assert.doesNotMatch(source, /virtualnet.control_required/);
  assert.doesNotMatch(source, /network\.nodoka\.top|100\.64\.0\.3|ENB_NODE_CONTROL_URL/);
});

test("virtual network refreshes server associations when returning and while jobs finish", () => {
  assert.match(source, /window.addEventListener\("focus", onReturn\)/);
  assert.match(source, /document.addEventListener\("visibilitychange", onReturn\)/);
  assert.match(source, /window.setInterval\(onReturn, 5000\)/);
  assert.match(source, /virtualnet.deletion_notice/);
  assert.match(source, /setProfiles\(p \|\| \[\]\); setJobs\(j \|\| \[\]\)/);
});

test("SSH fields reserve compact input and label space instead of medium border-box sizing", () => {
  assert.match(source, /size="small" fullWidth/);
  assert.match(source, /inputLabel: \{ shrink: true \}/);
  assert.match(source, /height: 40, minHeight: 40/);
  assert.match(source, /virtualnet.connection_hint/);
});

test("SSH errors distinguish host identity, account authentication, timeout and invalid keys", () => {
  for (const [message, key] of [
    ["SSH host key mismatch", "host_key"],
    ["SSH authentication failed", "authentication"],
    ["SSH handshake timed out", "timeout"],
    ["SSH endpoint unreachable", "unreachable"],
    ["SSH handshake failed", "handshake"],
    ["invalid SSH private key or passphrase", "private_key"],
  ]) assert.equal(virtualnetErrorKey(new Error(`RPC Error -32602: ${message}`)), `virtualnet.errors.${key}`);
  assert.equal(virtualnetErrorKey(new Error("other error")), undefined);
});

test("virtual network never restores secrets from profile responses", () => {
  assert.match(source, /password: "", private_key: "", passphrase: "", sudo_password: ""/);
  assert.match(source, /setConfirm\(peer\)/);
  assert.match(source, /virtualnet.confirm_deploy/);
});

test("overwrite requires server inspection and explicit confirmation before deploy", () => {
  assert.match(source,/admin:virtualnet.inspect/);
  assert.match(source,/setOverwriteConfirmed\(false\)/);
  assert.match(source,/requires_overwrite && !overwriteConfirmed/);
  assert.match(source,/confirmation_token: installationCheck.confirmation_token/);
  assert.match(source,/overwrite_confirmed: overwriteConfirmed/);
  assert.match(source,/virtualnet.overwrite_warning/);
});

test("withdraw and resume use separate confirmed actions without overwrite",()=>{
 assert.match(source,/inspectLifecycle\(peer,"pause"\)/);
 assert.match(source,/inspectLifecycle\(peer,"resume"\)/);
 assert.match(source,/confirmation_token:lifecycleConfirm.check.confirmation_token/);
 assert.match(source,/virtualnet.resume_notice/);
 assert.match(source,/virtualnet.pause_notice/);
 assert.match(source,/\.paused && !force\) \{ await inspectLifecycle\(peer,"resume"\)/);
});

test("deployment copy places Node under the SSH login user's home in every locale", () => {
  for (const locale of ["zh_CN", "zh_TW", "en", "ja_JP"]) {
    const data = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), "utf8"));
    assert.match(data.virtualnet.deploy_notice, /enb\/node/);
    assert.doesNotMatch(data.virtualnet.deploy_notice, /\/opt\/enb/);
    assert.match(data.virtualnet.deploy_notice, /host/);
    assert.match(data.virtualnet.deploy_notice, /iproute2/);
  }
});
