"use client";

import { FormEvent, useState } from "react";

type Item = {
  item_id: number;
  name: string;
  price: string;
  is_veg: boolean;
  is_available: boolean;
};

export default function MenuEditor({
  ownerId,
  restaurantId,
  items,
}: {
  ownerId: number;
  restaurantId: number;
  items: Item[];
}) {
  const [busyId, setBusyId] = useState<number | "new" | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusyId("new");
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    try {
      const response = await fetch("/api/menu-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: ownerId,
          restaurant_id: restaurantId,
          name: fd.get("name"),
          price: Number(fd.get("price")),
          is_veg: fd.get("is_veg") === "on",
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `Added "${data.name}" at ₹${data.price}.`, isError: false });
        setTimeout(() => location.reload(), 500);
      } else {
        setMessage({ text: data.error || "Could not add item.", isError: true });
      }
    } catch {
      setMessage({ text: "Could not reach server.", isError: true });
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(item: Item) {
    setBusyId(item.item_id);
    setMessage(null);
    try {
      const response = await fetch("/api/menu-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: ownerId,
          item_id: item.item_id,
          is_available: !item.is_available,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `Updated "${data.name}" availability.`, isError: false });
        setTimeout(() => location.reload(), 400);
      } else {
        setMessage({ text: data.error || "Could not update item.", isError: true });
      }
    } catch {
      setMessage({ text: "Could not reach server.", isError: true });
    } finally {
      setBusyId(null);
    }
  }

  async function updatePrice(e: FormEvent<HTMLFormElement>, item: Item) {
    e.preventDefault();
    setBusyId(item.item_id);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const price = Number(fd.get("price"));
    try {
      const response = await fetch("/api/menu-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: ownerId, item_id: item.item_id, price }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({
          text: `Price of "${data.name}" changed to ₹${data.price} (historical order_items.unit_price remains unchanged).`,
          isError: false,
        });
        setTimeout(() => location.reload(), 650);
      } else {
        setMessage({ text: data.error || "Could not update price.", isError: true });
      }
    } catch {
      setMessage({ text: "Could not reach server.", isError: true });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div>
        {items.map(i => (
          <div className="order-row" key={i.item_id}>
            <div>
              <span>{i.is_veg ? "🟢" : "🔴"} <strong>{i.name}</strong></span>{" "}
              <span className="muted">· ₹{Number(i.price).toFixed(2)}</span>{" "}
              <span className={i.is_available ? "badge green" : "badge red"}>
                {i.is_available ? "Available" : "Unavailable"}
              </span>
            </div>
            <div className="inline-actions">
              <form className="inline-actions" onSubmit={e => updatePrice(e, i)}>
                <input
                  aria-label={`New price for ${i.name}`}
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={i.price}
                  style={{ width: 92 }}
                />
                <button className="outline sm" disabled={busyId === i.item_id}>
                  Save ₹
                </button>
              </form>
              <button
                type="button"
                className={i.is_available ? "secondary sm" : "sm"}
                disabled={busyId === i.item_id}
                onClick={() => toggle(i)}
              >
                {i.is_available ? "Mark unavailable" : "Mark available"}
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="muted">No menu items yet for this restaurant.</p>}
      </div>

      <form className="filters" style={{ marginTop: 12, marginBottom: 0 }} onSubmit={add}>
        <input name="name" placeholder="New dish name" required />
        <input name="price" type="number" min="0" step="0.01" placeholder="Price ₹" required style={{ width: 110 }} />
        <label className="inline-actions">
          <input name="is_veg" type="checkbox" defaultChecked /> Vegetarian
        </label>
        <button disabled={busyId === "new"}>{busyId === "new" ? "Adding…" : "Add dish"}</button>
      </form>

      {message && (
        <div className={message.isError ? "notice error" : "notice"}>{message.text}</div>
      )}
    </>
  );
}
