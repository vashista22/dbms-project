import Link from "next/link";
import { pool } from "@/lib/db";
import OrderStatus from "../order-status";

export const dynamic = "force-dynamic";

type PartnerRow = {
  partner_id: number;
  name: string;
  vehicle_no: string;
  city: string;
  status: string;
  active_order_id: number | null;
};

type ActiveOrderRow = {
  order_id: number;
  status: string;
  total: string;
  restaurant: string;
  customer_name: string;
  address_line: string;
  address_city: string;
  payment_method: string | null;
  payment_status: string | null;
  placed_at: string;
};

type CompletedOrderRow = {
  order_id: number;
  status: string;
  total: string;
  restaurant: string;
  delivered_at: string | null;
  delivery_rating: number | null;
};

export default async function PartnerPage({
  searchParams,
}: {
  searchParams: Promise<{ partner_id?: string }>;
}) {
  const sp = await searchParams;

  const partners = (
    await pool.query<PartnerRow>(
      `SELECT dp.partner_id, u.name, dp.vehicle_no, dp.city, dp.status,
              o.order_id AS active_order_id
       FROM delivery_partners dp
       JOIN users u ON u.user_id = dp.partner_id
       LEFT JOIN orders o
         ON o.partner_id = dp.partner_id
        AND o.status IN ('accepted', 'preparing', 'picked_up')
       ORDER BY (o.order_id IS NOT NULL) DESC, dp.partner_id`
    )
  ).rows;

  const requestedId = sp.partner_id && /^\d+$/.test(sp.partner_id) ? Number(sp.partner_id) : null;
  const activePartner =
    partners.find(p => p.partner_id === requestedId) ??
    partners.find(p => p.active_order_id !== null) ??
    partners[0] ??
    null;
  const partnerId = activePartner?.partner_id ?? 7;

  const [activeOrdersRes, historyRes] = await Promise.all([
    pool.query<ActiveOrderRow>(
      `SELECT o.order_id, o.status, o.total, r.name AS restaurant,
              cu.name AS customer_name, a.line AS address_line, a.city AS address_city,
              p.method AS payment_method, p.status AS payment_status, o.placed_at
       FROM orders o
       JOIN restaurants r USING (restaurant_id)
       JOIN users cu ON cu.user_id = o.customer_id
       JOIN addresses a ON a.user_id = o.customer_id AND a.address_no = o.address_no
       LEFT JOIN payments p ON p.order_id = o.order_id
       WHERE o.partner_id = $1 AND o.status IN ('accepted', 'preparing', 'picked_up')
       ORDER BY o.placed_at`,
      [partnerId]
    ),
    pool.query<CompletedOrderRow>(
      `SELECT o.order_id, o.status, o.total, r.name AS restaurant,
              o.delivered_at, rv.delivery_rating
       FROM orders o
       JOIN restaurants r USING (restaurant_id)
       LEFT JOIN reviews rv ON rv.order_id = o.order_id
       WHERE o.partner_id = $1 AND o.status IN ('delivered', 'cancelled')
       ORDER BY o.placed_at DESC
       LIMIT 10`,
      [partnerId]
    ),
  ]);

  return (
    <>
      <section className="intro">
        <h1>Delivery Partner Portal</h1>
        <p className="muted">
          Advance assigned deliveries sequentially (<code>accepted → preparing → picked_up → delivered</code>).
          Delivering or cancelling settles COD payments and automatically releases the partner to{" "}
          <code>available</code>.
        </p>
      </section>

      <section className="panel" style={{ marginBottom: 18 }}>
        <h3>Delivery Partner Roster (Click to Switch Active Partner)</h3>
        <div className="chip-list">
          {partners.map(p => (
            <Link
              key={p.partner_id}
              href={`/partner?partner_id=${p.partner_id}`}
              className={p.partner_id === partnerId ? "chip active" : "chip"}
            >
              <span>#{p.partner_id} {p.name}</span>
              <span className="muted">({p.city} · {p.vehicle_no})</span>
              <span className={p.status === "available" ? "badge green" : p.status === "busy" ? "badge orange" : "badge"}>
                {p.status}
              </span>
              {p.active_order_id && <span className="badge blue">Order #{p.active_order_id}</span>}
            </Link>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="card-header">
          <div>
            <h2>
              Active Assigned Delivery · {activePartner?.name ?? `Partner #${partnerId}`}
            </h2>
            <p className="muted">
              City: {activePartner?.city ?? "—"} · Vehicle: {activePartner?.vehicle_no ?? "—"} · Status:{" "}
              <strong>{activePartner?.status ?? "—"}</strong>
            </p>
          </div>
          <span className={activePartner?.status === "busy" ? "badge orange" : "badge green"}>
            {activePartner?.status ?? "unknown"}
          </span>
        </div>

        {activeOrdersRes.rows.map(o => (
          <div className="order-row" key={o.order_id}>
            <div>
              <strong>Order #{o.order_id}</strong> · {o.restaurant} → {o.customer_name} ·{" "}
              <strong>₹{o.total}</strong>{" "}
              {o.payment_method && (
                <span className="badge">
                  {o.payment_method.toUpperCase()} ({o.payment_status})
                </span>
              )}
              <div className="muted" style={{ marginTop: 4 }}>
                Drop-off: {o.address_line}, {o.address_city}
              </div>
            </div>
            <OrderStatus orderId={o.order_id} status={o.status} />
          </div>
        ))}

        {activeOrdersRes.rows.length === 0 && (
          <p className="muted">
            No active delivery assigned to this partner. Select a <code>busy</code> partner above or assign a placed
            order on the Owner dashboard.
          </p>
        )}
      </section>

      <section className="panel orders">
        <h2>Recent Completed Deliveries</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Restaurant</th>
                <th>Total</th>
                <th>Status</th>
                <th>Delivery Rating</th>
              </tr>
            </thead>
            <tbody>
              {historyRes.rows.map(h => (
                <tr key={h.order_id}>
                  <td>#{h.order_id}</td>
                  <td>{h.restaurant}</td>
                  <td>₹{h.total}</td>
                  <td>
                    <span className={h.status === "delivered" ? "badge green" : "badge red"}>{h.status}</span>
                  </td>
                  <td>{h.delivery_rating ? `★ ${h.delivery_rating}/5` : "Not rated"}</td>
                </tr>
              ))}
              {historyRes.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">No past deliveries recorded for this partner yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
