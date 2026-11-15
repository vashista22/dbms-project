"use client";

import { FormEvent, useState } from "react";

type Dish = {
  item_id: number;
  name: string;
  price: string;
  is_veg: boolean;
};

type Address = {
  address_no: number;
  label: string | null;
  line: string;
  city: string;
};

export default function OrderForm({
  customerId,
  restaurantId,
  dishes,
  addresses,
}: {
  customerId: number;
  restaurantId: number;
  dishes: Dish[];
  addresses: Address[];
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const addressNo = Number(fd.get("address_no"));
    const items = dishes
      .map(d => ({ item_id: d.item_id, quantity: Number(fd.get(`q-${d.item_id}`) || 0) }))
      .filter(x => x.quantity > 0);

    if (!addressNo) {
      setMessage({ text: "Select a delivery address first.", isError: true });
      setBusy(false);
      return;
    }
    if (!items.length) {
      setMessage({ text: "Choose at least one dish to place an order.", isError: true });
      setBusy(false);
      return;
    }

    try {
      const couponRaw = String(fd.get("coupon") || "").trim();
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          address_no: addressNo,
          restaurant_id: restaurantId,
          items,
          coupon_code: couponRaw || null,
          payment_method: fd.get("method"),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          text: `Order #${data.order_id} placed! Subtotal ₹${data.subtotal} + Delivery ₹${data.delivery_fee} − Discount ₹${data.discount} = ₹${data.total}`,
          isError: false,
        });
        setTimeout(() => location.reload(), 650);
      } else {
        setMessage({ text: data.error || "Could not place order.", isError: true });
      }
    } catch {
      setMessage({
        text: "Could not reach the server. Check the database connection and try again.",
        isError: true,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!dishes.length) {
    return <p className="muted">No available dishes match your current filters.</p>;
  }

  return (
    <form className="order-form" onSubmit={submit}>
      <div>
        {dishes.map(d => (
          <div className="dish" key={d.item_id}>
            <span>
              {d.is_veg ? "🟢" : "🔴"} {d.name}{" "}
              <span className="muted">₹{Number(d.price).toFixed(2)}</span>
            </span>
            <input
              aria-label={`Quantity for ${d.name}`}
              type="number"
              min="0"
              max="20"
              name={`q-${d.item_id}`}
              defaultValue="0"
            />
          </div>
        ))}
      </div>

      <select name="address_no" aria-label="Delivery address" defaultValue={addresses[0]?.address_no ?? ""}>
        {addresses.map(a => (
          <option key={a.address_no} value={a.address_no}>
            #{a.address_no} {a.label || "Address"} · {a.city} ({a.line.slice(0, 32)})
          </option>
        ))}
      </select>

      <div className="inline-actions">
        <input name="coupon" placeholder="Coupon code (optional)" />
        <select name="method" aria-label="Payment method">
          <option value="upi">UPI (Instant)</option>
          <option value="card">Card (Instant)</option>
          <option value="cod">Cash on Delivery</option>
        </select>
      </div>

      <button disabled={busy || !addresses.length}>
        {busy ? "Placing order…" : "Place order"}
      </button>

      {message && (
        <div className={message.isError ? "notice error" : "notice"}>{message.text}</div>
      )}
    </form>
  );
}
