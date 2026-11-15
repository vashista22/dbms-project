"use client";

import { useState } from "react";

export default function RestaurantToggle({
  ownerId,
  restaurantId,
  isOpen,
}: {
  ownerId: number;
  restaurantId: number;
  isOpen: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/restaurants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: ownerId, restaurant_id: restaurantId, is_open: !isOpen }),
      });
      const data = await res.json();
      if (res.ok) {
        location.reload();
      } else {
        setError(data.error || "Could not update status.");
      }
    } catch {
      setError("Server error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-actions">
      <span className={isOpen ? "badge green" : "badge red"}>
        {isOpen ? "Open" : "Closed"}
      </span>
      <button type="button" className="outline sm" disabled={busy} onClick={toggle}>
        {busy ? "Updating…" : isOpen ? "Close Restaurant" : "Open Restaurant"}
      </button>
      {error && <small className="badge red">{error}</small>}
    </span>
  );
}
