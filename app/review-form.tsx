"use client";

import { FormEvent, useState } from "react";

export default function ReviewForm({
  customerId,
  orderId,
}: {
  customerId: number;
  orderId: number;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          order_id: orderId,
          food_rating: Number(fd.get("food_rating")),
          delivery_rating: Number(fd.get("delivery_rating")),
          comment: String(fd.get("comment") || ""),
        }),
      });
      const d = await r.json();
      if (r.ok) {
        setMessage({ text: "Review saved! Restaurant avg_rating synced via trigger.", isError: false });
        setTimeout(() => location.reload(), 500);
      } else {
        setMessage({ text: d.error || "Review could not be saved.", isError: true });
      }
    } catch {
      setMessage({ text: "Could not reach the server.", isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline-actions" onSubmit={submit}>
      <select name="food_rating" aria-label="Food rating" defaultValue="5">
        {[5, 4, 3, 2, 1].map(n => (
          <option key={n} value={n}>Food: {n}/5</option>
        ))}
      </select>
      <select name="delivery_rating" aria-label="Delivery rating" defaultValue="5">
        {[5, 4, 3, 2, 1].map(n => (
          <option key={n} value={n}>Delivery: {n}/5</option>
        ))}
      </select>
      <input name="comment" maxLength={1000} placeholder="Comment (optional)" />
      <button className="sm" disabled={busy}>{busy ? "Saving…" : "Submit review"}</button>
      {message && (
        <small className={message.isError ? "badge red" : "badge green"}>{message.text}</small>
      )}
    </form>
  );
}
