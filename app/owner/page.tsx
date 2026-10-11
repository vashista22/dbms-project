import { pool } from "@/lib/db";
import MenuEditor from "./menu-editor";
import AssignOrder from "./assign-order";
import CancelOrder from "./cancel-order";
export const dynamic="force-dynamic";
export default async function OwnerPage(){
 const restaurants=(await pool.query("SELECT restaurant_id,name,city FROM restaurants WHERE owner_id=2 ORDER BY name")).rows;
 const ids=restaurants.map(r=>r.restaurant_id);
 const items=ids.length?(await pool.query("SELECT item_id,restaurant_id,name,price,is_veg,is_available FROM menu_items WHERE restaurant_id=ANY($1::int[]) ORDER BY restaurant_id,name",[ids])).rows:[];
 const orders=ids.length?(await pool.query("SELECT o.order_id,o.status,o.total,r.name restaurant FROM orders o JOIN restaurants r USING(restaurant_id) WHERE o.restaurant_id=ANY($1::int[]) AND o.status IN ('placed','accepted','preparing') ORDER BY o.placed_at",[ids])).rows:[];
 return <><h1>Restaurant owner</h1><p className="muted">Demo owner ID 2 · Manage the menu, accept new work by assigning a partner, and cancel before pickup.</p>{restaurants.map(r=><section className="panel" key={r.restaurant_id}><h2>{r.name} · {r.city}</h2><MenuEditor restaurantId={r.restaurant_id} items={items.filter(i=>i.restaurant_id===r.restaurant_id)}/></section>)}<section className="panel orders"><h2>Orders to fulfill</h2>{orders.map(o=><div className="order-row" key={o.order_id}><span>#{o.order_id} · {o.restaurant} · ₹{o.total} · {o.status}</span><span>{o.status==='placed'?<AssignOrder orderId={o.order_id}/>:<span className="muted">Partner assigned</span>} <CancelOrder orderId={o.order_id}/></span></div>)}{!orders.length&&<p className="muted">No open orders.</p>}</section></>;
}
