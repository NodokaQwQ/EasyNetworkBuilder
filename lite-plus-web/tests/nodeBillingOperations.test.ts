import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { finishTrafficReset, saveNodeBillingEdit } from "../src/utils/nodeBilling.ts";

const page = readFileSync("src/pages/admin/index.tsx", "utf8");
const detail = readFileSync("src/pages/admin/NodeDetailPage.tsx", "utf8");

test("node actions open one node's settings and shared billing operations on demand", () => {
  assert.match(page, /billingConfiguration.*setDialog\("billing"\)/);
  assert.match(page, /React\.lazy\(\(\) =>\s*import\("\.\/NodeDetailPage"\)/);
  assert.match(page, /<NodeBillingPanel key=\{node\.uuid\} node=\{node\} onSaved=\{refresh\}/);
  assert.match(page, /Tabs\.Content value="settings"/);
  assert.match(page, /Tabs\.Content value="operations"/);
  assert.match(page, /if \(saving \|\| operationsBusy\) return/);
  assert.match(detail, /export function BillingPanel/);
  for (const action of ["changeCycle", "renewNow", "transfer", "autoRenewOn", "recordTrafficReset", "oneTimeFee"]) {
    assert.ok(detail.includes(`admin.nodeDetail.${action}`));
  }
});

test("all admin languages describe billing operations and partial quota failure", () => {
  for (const locale of ["zh_CN", "zh_TW", "en", "ja_JP"]) {
    const { admin } = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, "utf8"));
    for (const key of ["billingConfiguration", "billingConfigurationDescription", "billingSettings"]) assert.ok(admin.nodeTable[key], `${locale}:${key}`);
    for (const key of ["trafficResetPartial", "retryTrafficAllowance", "trafficResetCumulativeHint"]) assert.ok(admin.nodeDetail[key], `${locale}:${key}`);
  }
});

test("quota failure is reported; retry skips an already confirmed expense", async () => {
  const original = globalThis.fetch;
  let recorded = false;
  let expenses = 0;
  const edits: unknown[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      edits.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ status: "error", message: "quota failed" }), { status: 500 });
    };
    const options = {
      client: "node-a", allowance: 200, originalAllowance: 100,
      recordExpense: async () => { expenses++; },
      expenseRecorded: recorded,
      onExpenseRecorded: () => { recorded = true; },
    };
    await assert.rejects(finishTrafficReset(options), /quota failed/);
    assert.equal(recorded, true);
    globalThis.fetch = async (_url, init) => {
      edits.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ status: "success" }));
    };
    await finishTrafficReset({ ...options, expenseRecorded: recorded });
    assert.equal(expenses, 1);
    assert.deepEqual(edits, [{ traffic_reset_allowance: 200 }, { traffic_reset_allowance: 200 }]);
  } finally { globalThis.fetch = original; }
});

test("business errors and malformed edit responses cannot report success", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [new Response('{"status":"error","message":"rejected"}'), new Response("invalid")]) {
      globalThis.fetch = async () => response;
      await assert.rejects(saveNodeBillingEdit("node-a", {}));
    }
  } finally { globalThis.fetch = original; }
});

test("unchanged allowance only records expense; failed expense never updates quota", async () => {
  let recorded = false;
  const options = { client: "node-a", allowance: 100, originalAllowance: 100, expenseRecorded: false,
    recordExpense: async () => {}, onExpenseRecorded: () => { recorded = true; } };
  await finishTrafficReset(options);
  assert.equal(recorded, true);
  recorded = false;
  await assert.rejects(finishTrafficReset({ ...options, allowance: 200, recordExpense: async () => { throw new Error("billing failed"); } }), /billing failed/);
  assert.equal(recorded, false);
});
