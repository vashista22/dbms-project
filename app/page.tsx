import { pool } from "@/lib/db";
import OrderForm from "./order-form";
import ReviewForm from "./review-form";

export const dynamic = "force-dynamic";

type CustomerOption = { user_id: number; name: string; city: string };
type Address = { address_no: number; label: string | null; line: string; city: string; pincode: string };
type Coupon = {
  code: string;
  discount_pct: number;
  max_discount: string | null;
  min_order: string;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
};
type Restaurant = { restaurant_id: number; name: string; city: string; avg_rating: string | null; cuisines: string | null };
type Dish = { item_id: number; restaurant_id: number; name: string; price: string; is_veg: boolean };
type Order = {
  order_id: number;
  restaurant: string;
  status: string;
  subtotal: string;
  delivery_fee: string;
  discount: string;
  total: string;
  coupon_code: string | null;
  placed_at: string;
  address_label: string | null;
  address_city: string;
  payment_method: string | null;
  payment_status: string | null;
  partner_name: string | null;
  food_rating: number | null;
  delivery_rating: number | null;
  review_comment: string | null;
};
type OrderItemRow = { order_id: number; dish_name: string; quantity: number; unit_price: string };

function statusBadgeClass(status: string) {
  if (status === "delivered") return "badge green";
  if (status === "cancelled") return "badge red";
  if (status === "placed") return "badge orange";
  return "badge blue";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    customer_id?: string;
    city?: string;
    cuisine?: string;
    veg?: string;
    min_price?: string;
    max_price?: string;
  }>;
}) {
  const filters = await searchParams;

  const customers = (
    await pool.query<CustomerOption>(
      `SELECT u.user_id, u.name, MIN(a.city) AS city
       FROM users u
       JOIN addresses a ON a.user_id = u.user_id
       WHERE u.role = 'customer'
       GROUP BY u.user_id, u.name
       ORDER BY u.user_id`
    )
  ).rows;

  const requestedCustomerId = filters.customer_id && /^\d+$/.test(filters.customer_id) ? Number(filters.customer_id) : null;
  const activeCustomer =
    customers.find(c => c.user_id === requestedCustomerId) ?? customers[0] ?? null;
  const customerId = activeCustomer?.user_id ?? 1;

  const [addressesRes, couponsRes] = await Promise.all([
    pool.query<Address>(
      "SELECT address_no, label, line, city, pincode FROM addresses WHERE user_id = $1 ORDER BY address_no",
      [customerId]
    ),
    pool.query<Coupon>(
      `SELECT code, discount_pct, max_discount, min_order,
              to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
              to_char(valid_to, 'YYYY-MM-DD') AS valid_to,
              (CURRENT_DATE BETWEEN valid_from AND valid_to) AS is_active
       FROM coupons
       ORDER BY is_active DESC, code`
    ),
  ]);

  const args: unknown[] = [];
  const where: string[] = ["r.is_open = true"];
  if (filters.city) {
    args.push(`%${filters.city}%`);
    where.push(`r.city ILIKE $${args.length}`);
  }
  if (filters.cuisine) {
    args.push(`%${filters.cuisine}%`);
    where.push(
      `EXISTS (SELECT 1 FROM restaurant_cuisines rc JOIN cuisines c USING (cuisine_id) WHERE rc.restaurant_id = r.restaurant_id AND c.name ILIKE $${args.length})`
    );
  }

  const dishConditions = ["p.restaurant_id = r.restaurant_id", "p.is_available"];
  if (filters.veg === "true") dishConditions.push("p.is_veg");
  const minPrice = filters.min_price === undefined || filters.min_price === "" ? null : Number(filters.min_price);
  const maxPrice = filters.max_price === undefined || filters.max_price === "" ? null : Number(filters.max_price);
  const invalidPriceFilter =
    (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) ||
    (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) ||
    (minPrice !== null && maxPrice !== null && minPrice > maxPrice);
  if (minPrice !== null && Number.isFinite(minPrice) && minPrice >= 0) {
    args.push(minPrice);
    dishConditions.push(`p.price >= $${args.length}`);
  }
  if (maxPrice !== null && Number.isFinite(maxPrice) && maxPrice >= 0) {
    args.push(maxPrice);
    dishConditions.push(`p.price <= $${args.length}`);
  }
  if (filters.veg === "true" || minPrice !== null || maxPrice !== null) {
    where.push(`EXISTS (SELECT 1 FROM menu_items p WHERE ${dishConditions.join(" AND ")})`);
  }
  if (invalidPriceFilter) where.push("FALSE");

  const restaurants = (
    await pool.query<Restaurant>(
      `SELECT r.restaurant_id, r.name, r.city, r.avg_rating,
              string_agg(c.name, ', ' ORDER BY c.name) AS cuisines
       FROM restaurants r
       LEFT JOIN restaurant_cuisines rc USING (restaurant_id)
       LEFT JOIN cuisines c USING (cuisine_id)
       WHERE ${where.join(" AND ")}
       GROUP BY r.restaurant_id
       ORDER BY r.name`,
      args
    )
  ).rows;

  const dishes = restaurants.length
    ? (
        await pool.query<Dish>(
          `SELECT item_id, restaurant_id, name, price, is_veg
           FROM menu_items
           WHERE is_available AND restaurant_id = ANY($1::int[])
           ORDER BY restaurant_id, name`,
          [restaurants.map(r => r.restaurant_id)]
        )
      ).rows
    : [];

  const orders = (
    await pool.query<Order>(
      `SELECT o.order_id, r.name AS restaurant, o.status, o.subtotal, o.delivery_fee, o.discount, o.total,
              o.coupon_code, o.placed_at,
              a.label AS address_label, a.city AS address_city,
              p.method AS payment_method, p.status AS payment_status,
              pu.name AS partner_name,
              rv.food_rating, rv.delivery_rating, rv.comment AS review_comment
       FROM orders o
       JOIN restaurants r USING (restaurant_id)
       JOIN addresses a ON a.user_id = o.customer_id AND a.address_no = o.address_no
       LEFT JOIN payments p ON p.order_id = o.order_id
       LEFT JOIN users pu ON pu.user_id = o.partner_id
       LEFT JOIN reviews rv ON rv.order_id = o.order_id
       WHERE o.customer_id = $1
       ORDER BY o.placed_at DESC, o.order_id DESC
       LIMIT 12`,
      [customerId]
    )
  ).rows;

  const orderIds = orders.map(o => o.order_id);
  const orderItems = orderIds.length
    ? (
        await pool.query<OrderItemRow>(
          `SELECT oi.order_id, m.name AS dish_name, oi.quantity, oi.unit_price
           FROM order_items oi
           JOIN menu_items m ON m.item_id = oi.item_id
           WHERE oi.order_id = ANY($1::int[])
           ORDER BY oi.order_id, m.name`,
          [orderIds]
        )
      ).rows
    : [];

  return (
    <>
      <section className="intro">
        <h1>Customer Portal · Browse &amp; Order</h1>
        <p className="muted">
          Search open restaurants by city, cuisine, vegetarian filter, and price. Orders execute transactionally across{" "}
          <code>orders</code>, <code>order_items</code> (price snapshot), and <code>payments</code>.
        </p>
      </section>

      <section className="switcher-bar">
        <form className="switcher-form" action="/">
          <label htmlFor="customer-select"><strong>Active Customer:</strong></label>
          <select id="customer-select" name="customer_id" defaultValue={String(customerId)}>
            {customers.map(c => (
              <option key={c.user_id} value={c.user_id}>
                #{c.user_id} · {c.name} ({c.city})
              </option>
            ))}
          </select>
          {filters.city && <input type="hidden" name="city" value={filters.city} />}
          {filters.cuisine && <input type="hidden" name="cuisine" value={filters.cuisine} />}
          {filters.veg && <input type="hidden" name="veg" value={filters.veg} />}
          {filters.min_price && <input type="hidden" name="min_price" value={filters.min_price} />}
          {filters.max_price && <input type="hidden" name="max_price" value={filters.max_price} />}
          <button type="submit" className="secondary sm">Switch Customer</button>
        </form>
        <div className="muted">
          Addresses on file: <strong>{addressesRes.rows.length}</strong> · Delivery fee: <strong>₹49.00</strong>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 18 }}>
        <h3>Available Coupons (Date &amp; Minimum Order Validated Inside Transaction)</h3>
        <div className="chip-list">
          {couponsRes.rows.map(c => (
            <span key={c.code} className={c.is_active ? "chip active" : "chip"}>
              <code>{c.code}</code> · {c.discount_pct}% off (up to ₹{c.max_discount ?? "∞"}, min ₹{c.min_order}) ·{" "}
              {c.is_active ? `Valid till ${c.valid_to}` : `Expired ${c.valid_to}`}
            </span>
          ))}
        </div>
      </section>

      <form className="filters" action="/">
        <input type="hidden" name="customer_id" value={String(customerId)} />
        <input name="city" placeholder="City (e.g. Hyderabad, Bengaluru)" defaultValue={filters.city} />
        <input name="cuisine" placeholder="Cuisine (e.g. Biryani, Italian)" defaultValue={filters.cuisine} />
        <input type="number" min="0" step="0.01" name="min_price" placeholder="Min dish ₹" defaultValue={filters.min_price} />
        <input type="number" min="0" step="0.01" name="max_price" placeholder="Max dish ₹" defaultValue={filters.max_price} />
        <label className="inline-actions">
          <input type="checkbox" name="veg" value="true" defaultChecked={filters.veg === "true"} />
          Veg only
        </label>
        <button type="submit">Search</button>
        <a href={`/?customer_id=${customerId}`} className="chip">Reset</a>
      </form>

      {invalidPriceFilter && (
        <p className="notice error">
          Enter a valid non-negative price range; minimum must not exceed maximum.
        </p>
      )}

      <section className="grid">
        {restaurants.map(r => (
          <article className="card" key={r.restaurant_id}>
            <div className="card-header">
              <div>
                <h2>{r.name}</h2>
                <div className="muted">
                  {r.city} · {r.cuisines || "Cuisine not listed"}
                </div>
              </div>
              {r.avg_rating ? (
                <span className="badge green">★ {r.avg_rating}</span>
              ) : (
                <span className="badge">No ratings</span>
              )}
            </div>
            <OrderForm
              customerId={customerId}
              restaurantId={r.restaurant_id}
              addresses={addressesRes.rows}
              dishes={dishes.filter(
                d =>
                  d.restaurant_id === r.restaurant_id &&
                  (filters.veg !== "true" || d.is_veg) &&
                  (!filters.min_price || Number(d.price) >= Number(filters.min_price)) &&
                  (!filters.max_price || Number(d.price) <= Number(filters.max_price))
              )}
            />
          </article>
        ))}
        {restaurants.length === 0 && (
          <div className="panel">
            <p className="muted">No open restaurants match those filters. Try clearing city or price bounds.</p>
          </div>
        )}
      </section>

      <section className="panel orders">
        <h2>Recent Orders for {activeCustomer?.name ?? `Customer #${customerId}`}</h2>
        {orders.map(o => {
          const lines = orderItems.filter(li => li.order_id === o.order_id);
          return (
            <div className="order-row" key={o.order_id}>
              <div style={{ flex: "1 1 360px" }}>
                <div className="inline-actions">
                  <strong>Order #{o.order_id}</strong>
                  <span>· {o.restaurant}</span>
                  <span className={statusBadgeClass(o.status)}>{o.status}</span>
                  {o.payment_method && (
                    <span className="badge">
                      {o.payment_method.toUpperCase()} ({o.payment_status})
                    </span>
                  )}
                  {o.coupon_code && <span className="badge orange">Coupon: {o.coupon_code} (-₹{o.discount})</span>}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Deliver to: {o.address_label || "Address"} ({o.address_city}) ·{" "}
                  {o.partner_name ? `Partner: ${o.partner_name}` : "Awaiting partner"} · Total:{" "}
                  <strong>₹{o.total}</strong>
                </div>
                <div className="muted" style={{ marginTop: 2 }}>
                  Items (captured unit_price):{" "}
                  {lines.map(l => `${l.quantity}× ${l.dish_name} @ ₹${l.unit_price}`).join(", ")}
                </div>
              </div>

              <div>
                {o.status === "delivered" && (
                  o.food_rating !== null ? (
                    <span className="badge green">
                      Reviewed · Food {o.food_rating}/5 · Delivery {o.delivery_rating}/5
                      {o.review_comment ? ` — "${o.review_comment}"` : ""}
                    </span>
                  ) : (
                    <ReviewForm customerId={customerId} orderId={o.order_id} />
                  )
                )}
              </div>
            </div>
          );
        })}
        {orders.length === 0 && (
          <p className="muted">No orders yet for this customer. Place an order from any restaurant card above.</p>
        )}
      </section>
    </>
  );
}
