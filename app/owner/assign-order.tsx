"use client";

import { FormEvent, useState } from "react";

export type PartnerOption = {
  partner_id: number;
  name: string;
  city: string;
  vehicle_no: string;
  status: string;
};

export default function AssignOrder({
  orderId,
  partners,
}: {
  orderId: number;
  partners: PartnerOption[];
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const firstAvailable = partners.find(p => p.status === "available")?.partner_id ?? partners[0]?.partner_id;

  async function assign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const partnerId = Number(fd.get("partner_id"));
    try {
      const r = await fetch(`/api/orders/${orderId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partner_id: partnerId }),
      });
      const d = await r.json();
      if (r.ok) {
        setMessage({ text: `Assigned partner #${d.partner_id}.`, isError: false });
        setTimeout(() => location.reload(), 450);
      } else {
        setMessage({ text: d.error || "Assignment failed.", isError: true });
      }
    } catch {
      setMessage({ text: "Could not reach server.", isError: true });
    } finally {
      setBusy(false);
    }
  }

  if (!partners.length) {
    return <span className="badge red">No partners in this city</span>;
  }

  return (
    <form className="inline-actions" onSubmit={assign}>
      <select name="partner_id" aria-label={`Choose partner for order ${orderId}`} defaultValue={firstAvailable}>
        {partners.map(p => (
          <option key={p.partner_id} value={p.partner_id}>
            #{p.partner_id} {p.name} ({p.city} · {p.status})
          </option>
        ))}
      </select>
      <button className="sm" disabled={busy}>
        {busy ? "Assigning…" : "Assign & Accept"}
      </button>
      {message && (
        <small className={message.isError ? "badge red" : "badge green"}>{message.text}</small>
      )}
    </form>
  );
}
