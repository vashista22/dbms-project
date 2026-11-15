"use client";

import { useState } from "react";

const NEXT_STAGE: Record<string, { status: string; label: string }> = {
  accepted: { status: "preparing", label: "Mark Preparing" },
  preparing: { status: "picked_up", label: "Mark Picked Up" },
  picked_up: { status: "delivered", label: "Mark Delivered" },
};

export default function OrderStatus({
  orderId,
  status,
}: {
  orderId: number;
  status: string;
}) {
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const step = NEXT_STAGE[value];

  async function advance() {
    if (!step) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: step.status }),
      });
      const data = await res.json();
      if (res.ok) {
        setValue(data.status);
        setTimeout(() => location.reload(), 450);
      } else {
        setError(data.error || "Status update failed.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-actions">
      {step ? (
        <button type="button" className="sm" disabled={busy} onClick={advance}>
          {busy ? "Updating…" : step.label}
        </button>
      ) : (
        <span className="badge green">{value}</span>
      )}
      <span className="badge blue">Current: {value}</span>
      {error && <small className="badge red">{error}</small>}
    </span>
  );
}
