"use client";

import { useState } from "react";

export default function CancelOrder({ orderId }: { orderId: number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function cancel() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const d = await r.json();
      if (r.ok) {
        location.reload();
      } else {
        setMessage(d.error || "Cancellation failed.");
      }
    } catch {
      setMessage("Could not reach server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-actions">
      <button type="button" className="secondary sm" disabled={busy} onClick={cancel}>
        {busy ? "Cancelling…" : "Cancel before pickup"}
      </button>
      {message && <small className="badge red">{message}</small>}
    </span>
  );
}
