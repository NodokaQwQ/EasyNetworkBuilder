// Client edits may return only a success envelope, without billingRequest's data.
export async function saveNodeBillingEdit(client: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/admin/client/${client}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null) as { status?: string; message?: string } | null;
  if (!response.ok || body?.status !== "success") {
    throw new Error(body?.message || `HTTP ${response.status}`);
  }
}

// A confirmed expense is not submitted again if the separate quota edit fails.
// The caller retains both this checkpoint and the idempotency key until closing.
export async function finishTrafficReset(options: {
  recordExpense: () => Promise<unknown>;
  expenseRecorded: boolean;
  onExpenseRecorded: () => void;
  client: string;
  allowance: number;
  originalAllowance: number;
}) {
  if (!options.expenseRecorded) {
    await options.recordExpense();
    options.onExpenseRecorded();
  }
  if (options.allowance !== options.originalAllowance) {
    await saveNodeBillingEdit(options.client, { traffic_reset_allowance: options.allowance });
  }
}
