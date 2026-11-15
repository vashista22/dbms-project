import { pool } from "@/lib/db";
import { runReportsSnapshot } from "@/lib/reports";
import MenuEditor from "./menu-editor";
import AssignOrder, { PartnerOption } from "./assign-order";
import CancelOrder from "./cancel-order";
import RestaurantToggle from "./restaurant-toggle";

export const dynamic = "force-dynamic";

type OwnerOption = { user_id: number; name: string };
type RestaurantRow = {
  restaurant_id: number;
  name: string;
  city: string;
  address: string;
  is_open: boolean;
  avg_rating: string | null;
};
type MenuItemRow = {
  item_id: number;
  restaurant_id: number;
  name: string;
  price: string;
  is_veg: boolean;
  is_available: boolean;
};
type OrderRow = {
  order_id: number;
  status: string;
  total: string;
  restaurant: string;
  city: string;
  customer_name: string;
  partner_name: string | null;
  partner_id: number | null;
};

export default async function OwnerPage({
  searchParams,
}: {
  searchParams: Promise<{ owner_id?: string }>;
}) {
  const sp = await searchParams;
  const owners = (
    await pool.query<OwnerOption>(
      "SELECT user_id, name FROM users WHERE role = 'owner' ORDER BY user_id"
    )
  ).rows;

  const requestedOwnerId = sp.owner_id && /^\d+$/.test(sp.owner_id) ? Number(sp.owner_id) : null;
  const activeOwner = owners.find(o => o.user_id === requestedOwnerId) ?? owners[0] ?? null;
  const ownerId = activeOwner?.user_id ?? 2;

  const restaurants = (
    await pool.query<RestaurantRow>(
      `SELECT restaurant_id, name, city, address, is_open, avg_rating
       FROM restaurants
       WHERE owner_id = $1
       ORDER BY restaurant_id`,
      [ownerId]
    )
  ).rows;

  const ids = restaurants.map(r => r.restaurant_id);
  const [itemsRes, ordersRes, partnersRes, reports] = await Promise.all([
    ids.length
      ? pool.query<MenuItemRow>(
          `SELECT item_id, restaurant_id, name, price, is_veg, is_available
           FROM menu_items
           WHERE restaurant_id = ANY($1::int[])
           ORDER BY restaurant_id, item_id`,
          [ids]
        )
      : Promise.resolve({ rows: [] as MenuItemRow[] }),
    ids.length
      ? pool.query<OrderRow>(
          `SELECT o.order_id, o.status, o.total, r.name AS restaurant, r.city,
                  cu.name AS customer_name, pu.name AS partner_name, o.partner_id
           FROM orders o
           JOIN restaurants r USING (restaurant_id)
           JOIN users cu ON cu.user_id = o.customer_id
           LEFT JOIN users pu ON pu.user_id = o.partner_id
           WHERE o.restaurant_id = ANY($1::int[])
             AND o.status IN ('placed', 'accepted', 'preparing', 'picked_up')
           ORDER BY o.placed_at DESC, o.order_id DESC`,
          [ids]
        )
      : Promise.resolve({ rows: [] as OrderRow[] }),
    pool.query<PartnerOption>(
      `SELECT dp.partner_id, u.name, dp.city, dp.vehicle_no, dp.status
       FROM delivery_partners dp
       JOIN users u ON u.user_id = dp.partner_id
       ORDER BY dp.city, dp.status = 'available' DESC, dp.partner_id`
    ),
    runReportsSnapshot(ownerId),
  ]);

  const salesReport = reports.find(r => r.name === "restaurant-sales");
  const topDishesReport = reports.find(r => r.name === "top-dishes");
  const monthlyReport = reports.find(r => r.name === "monthly-revenue");

  const combinedOrders = (salesReport?.rows ?? []).reduce(
    (acc, row) => acc + Number(row.delivered_order_count || 0),
    0
  );
  const combinedRevenue = (salesReport?.rows ?? []).reduce(
    (acc, row) => acc + Number(row.delivered_revenue || 0),
    0
  );
  const avgOrderValue = combinedOrders > 0 ? combinedRevenue / combinedOrders : 0;

  return (
    <>
      <section className="intro">
        <h1>Restaurant Owner Dashboard</h1>
        <p className="muted">
          Manage restaurant availability, menu prices, order partner assignment (<code>FOR UPDATE</code> locking +
          partial unique index), and view owner sales analytics from PostgreSQL views.
        </p>
      </section>

      <section className="switcher-bar">
        <form className="switcher-form" action="/owner">
          <label htmlFor="owner-select"><strong>Active Owner:</strong></label>
          <select id="owner-select" name="owner_id" defaultValue={String(ownerId)}>
            {owners.map(o => (
              <option key={o.user_id} value={o.user_id}>
                #{o.user_id} · {o.name}
              </option>
            ))}
          </select>
          <button type="submit" className="secondary sm">Switch Owner</button>
        </form>
        <div className="muted">
          Restaurants owned: <strong>{restaurants.length}</strong> · Active orders:{" "}
          <strong>{ordersRes.rows.length}</strong>
        </div>
      </section>

      <section className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Delivered Orders</div>
          <div className="kpi-value">{combinedOrders}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Delivered Revenue</div>
          <div className="kpi-value">₹{combinedRevenue.toFixed(2)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg Order Value</div>
          <div className="kpi-value">₹{avgOrderValue.toFixed(2)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Open Restaurants</div>
          <div className="kpi-value">
            {restaurants.filter(r => r.is_open).length} / {restaurants.length}
          </div>
        </div>
      </section>

      <section className="panel orders">
        <h2>Active Orders to Fulfill</h2>
        <p className="muted">
          Assign an available delivery partner in the restaurant&apos;s city to accept a placed order, or select a{" "}
          <code>busy</code> partner to observe the transactional lock / constraint rejection.
        </p>
        {ordersRes.rows.map(o => {
          const cityPartners = partnersRes.rows.filter(p => p.city === o.city);
          return (
            <div className="order-row" key={o.order_id}>
              <div>
                <strong>Order #{o.order_id}</strong> · {o.restaurant} ({o.city}) · Customer: {o.customer_name} ·{" "}
                <strong>₹{o.total}</strong>{" "}
                <span className="badge blue">{o.status}</span>
                {o.partner_name && (
                  <span className="muted"> · Assigned to {o.partner_name} (#{o.partner_id})</span>
                )}
              </div>
              <div className="inline-actions">
                {o.status === "placed" ? (
                  <AssignOrder orderId={o.order_id} partners={cityPartners} />
                ) : (
                  <span className="badge green">Partner assigned</span>
                )}
                {o.status !== "picked_up" && <CancelOrder orderId={o.order_id} />}
              </div>
            </div>
          );
        })}
        {ordersRes.rows.length === 0 && (
          <p className="muted">No active orders waiting at your restaurants right now.</p>
        )}
      </section>

      <section className="panel">
        <h2>Owner Sales &amp; Top Dishes (from Reporting Views)</h2>
        <div className="grid" style={{ marginTop: 10 }}>
          <div>
            <h3>Sales by Restaurant (<code>view_restaurant_sales</code>)</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Restaurant</th>
                    <th>City</th>
                    <th>Orders</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {(salesReport?.rows ?? []).map((row, idx) => (
                    <tr key={idx}>
                      <td>{String(row.restaurant_name)}</td>
                      <td>{String(row.city)}</td>
                      <td>{String(row.delivered_order_count)}</td>
                      <td>₹{String(row.delivered_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3>Top Dishes (<code>view_top_dishes</code>)</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Dish</th>
                    <th>Restaurant</th>
                    <th>Units Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {(topDishesReport?.rows ?? []).map((row, idx) => (
                    <tr key={idx}>
                      <td>{String(row.dish_name)}</td>
                      <td>{String(row.restaurant_name)}</td>
                      <td>{String(row.units_sold)}</td>
                    </tr>
                  ))}
                  {(!topDishesReport || topDishesReport.rows.length === 0) && (
                    <tr>
                      <td colSpan={3} className="muted">No delivered dishes yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <h3 style={{ marginTop: 18 }}>Monthly Revenue (<code>view_restaurant_monthly_revenue</code>)</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Delivered Orders</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(monthlyReport?.rows ?? []).map((row, idx) => (
                <tr key={idx}>
                  <td>{String(row.month)}</td>
                  <td>{String(row.delivered_order_count)}</td>
                  <td>₹{String(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {restaurants.map(r => (
        <section className="panel" key={r.restaurant_id}>
          <div className="card-header">
            <div>
              <h2>{r.name} · {r.city}</h2>
              <div className="muted">
                {r.address} {r.avg_rating ? `· ★ ${r.avg_rating}` : "· No ratings yet"}
              </div>
            </div>
            <RestaurantToggle ownerId={ownerId} restaurantId={r.restaurant_id} isOpen={r.is_open} />
          </div>
          <MenuEditor
            ownerId={ownerId}
            restaurantId={r.restaurant_id}
            items={itemsRes.rows.filter(i => i.restaurant_id === r.restaurant_id)}
          />
        </section>
      ))}
    </>
  );
}
