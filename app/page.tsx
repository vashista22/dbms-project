import { pool } from "@/lib/db";
import OrderForm from "./order-form";
import ReviewForm from "./review-form";

export const dynamic = "force-dynamic";
type Restaurant = { restaurant_id: number; name: string; city: string; avg_rating: string | null; cuisines: string | null };
type Dish = { item_id: number; restaurant_id: number; name: string; price: string; is_veg: boolean };
type Order = { order_id: number; restaurant: string; status: string; total: string; placed_at: string; reviewed: boolean };

export default async function Home({ searchParams }: { searchParams: Promise<{ city?: string; cuisine?: string; veg?: string; min_price?: string; max_price?: string }> }) {
  const filters = await searchParams;
  const args: unknown[] = [];
  const where: string[] = ["r.is_open = true"];
  if (filters.city) { args.push(`%${filters.city}%`); where.push(`r.city ILIKE $${args.length}`); }
  if (filters.cuisine) { args.push(`%${filters.cuisine}%`); where.push(`EXISTS (SELECT 1 FROM restaurant_cuisines rc JOIN cuisines c USING (cuisine_id) WHERE rc.restaurant_id=r.restaurant_id AND c.name ILIKE $${args.length})`); }
  const dishConditions = ["p.restaurant_id=r.restaurant_id", "p.is_available"];
  if (filters.veg === "true") dishConditions.push("p.is_veg");
  const minPrice = filters.min_price === undefined || filters.min_price === "" ? null : Number(filters.min_price);
  const maxPrice = filters.max_price === undefined || filters.max_price === "" ? null : Number(filters.max_price);
  const invalidPriceFilter = (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice !== null && maxPrice !== null && minPrice > maxPrice);
  if (minPrice !== null && Number.isFinite(minPrice) && minPrice >= 0) { args.push(minPrice); dishConditions.push(`p.price >= $${args.length}`); }
  if (maxPrice !== null && Number.isFinite(maxPrice) && maxPrice >= 0) { args.push(maxPrice); dishConditions.push(`p.price <= $${args.length}`); }
  if (filters.veg === "true" || minPrice !== null || maxPrice !== null) where.push(`EXISTS (SELECT 1 FROM menu_items p WHERE ${dishConditions.join(" AND ")})`);
  if (invalidPriceFilter) where.push("FALSE");
  const restaurants = (await pool.query<Restaurant>(`SELECT r.restaurant_id,r.name,r.city,r.avg_rating,string_agg(c.name, ', ' ORDER BY c.name) cuisines FROM restaurants r LEFT JOIN restaurant_cuisines rc USING (restaurant_id) LEFT JOIN cuisines c USING (cuisine_id) WHERE ${where.join(" AND ")} GROUP BY r.restaurant_id ORDER BY r.name`, args)).rows;
  const dishes = restaurants.length ? (await pool.query<Dish>(`SELECT item_id,restaurant_id,name,price,is_veg FROM menu_items WHERE is_available AND restaurant_id = ANY($1::int[]) ORDER BY restaurant_id,name`, [restaurants.map(r => r.restaurant_id)])).rows : [];
  const orders = (await pool.query<Order>("SELECT o.order_id,r.name restaurant,o.status,o.total,o.placed_at,EXISTS(SELECT 1 FROM reviews rv WHERE rv.order_id=o.order_id) reviewed FROM orders o JOIN restaurants r USING (restaurant_id) WHERE o.customer_id=1 ORDER BY o.placed_at DESC LIMIT 10")).rows;
  return <><section className="intro"><h1>Find your next meal</h1><p className="muted">Browse the demo menu and place an order. Demo customer ID: <b>1</b>; address number: <b>1</b>.</p></section>
    <form className="filters" action="/"><input name="city" placeholder="City" defaultValue={filters.city}/><input name="cuisine" placeholder="Cuisine" defaultValue={filters.cuisine}/><input type="number" min="0" step="0.01" name="min_price" placeholder="Min dish ₹" defaultValue={filters.min_price}/><input type="number" min="0" step="0.01" name="max_price" placeholder="Max dish ₹" defaultValue={filters.max_price}/><label><input type="checkbox" name="veg" value="true" defaultChecked={filters.veg === "true"}/> Veg only</label><button>Search</button></form>
    {invalidPriceFilter&&<p className="notice error">Enter a valid non-negative price range; minimum must not exceed maximum.</p>}
    <section className="grid">{restaurants.map(r => <article className="card" key={r.restaurant_id}><h2>{r.name}</h2><div className="muted">{r.city} · {r.cuisines || "Cuisine not listed"}{r.avg_rating ? ` · ★ ${r.avg_rating}` : ""}</div><OrderForm restaurantId={r.restaurant_id} dishes={dishes.filter(d => d.restaurant_id === r.restaurant_id && (filters.veg !== "true" || d.is_veg) && (!filters.min_price || Number(d.price)>=Number(filters.min_price)) && (!filters.max_price || Number(d.price)<=Number(filters.max_price)))}/></article>)}{restaurants.length===0 && <p>No open restaurants match those filters.</p>}</section>
    <section className="panel orders"><h2>Recent orders</h2>{orders.map(o => <div className="order-row" key={o.order_id}><span>Order #{o.order_id} · {o.restaurant} · ₹{o.total} · {o.status}</span>{o.status==="delivered"&&(o.reviewed?<span className="muted">Reviewed</span>:<ReviewForm orderId={o.order_id}/>)}</div>)}{orders.length===0 && <p className="muted">No orders yet. Load the demo seed data to begin.</p>}</section></>;
}
