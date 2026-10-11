"use client";
import { FormEvent, useState } from "react";
type Dish = { item_id: number; name: string; price: string; is_veg: boolean };
export default function OrderForm({ restaurantId, dishes }: { restaurantId: number; dishes: Dish[] }) {
  const [busy,setBusy]=useState(false), [message,setMessage]=useState("");
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setMessage(""); const fd=new FormData(e.currentTarget); const items=dishes.map(d=>({item_id:d.item_id,quantity:Number(fd.get(`q-${d.item_id}`)||0)})).filter(x=>x.quantity>0);
    if(!items.length){setMessage("Choose at least one dish.");setBusy(false);return;}
    try{const res=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customer_id:1,address_no:1,restaurant_id:restaurantId,items,coupon_code:String(fd.get("coupon")||"").trim()||null,payment_method:fd.get("method")})});const data=await res.json();setMessage(res.ok?`Order #${data.order_id} placed · ₹${data.total}`:(data.error||"Could not place order."));if(res.ok)location.reload();}
    catch{setMessage("Could not reach the server. Check the database connection and try again.");}finally{setBusy(false);}
  }
  return <form className="order-form" onSubmit={submit}><div>{dishes.map(d=><div className="dish" key={d.item_id}><span>{d.is_veg?"🟢":"🔴"} {d.name} <span className="muted">₹{d.price}</span></span><input aria-label={`Quantity for ${d.name}`} type="number" min="0" max="20" name={`q-${d.item_id}`} defaultValue="0"/></div>)}</div><input name="coupon" placeholder="Coupon code (optional)"/><select name="method"><option value="upi">UPI</option><option value="card">Card</option><option value="cod">Cash on delivery</option></select><button disabled={busy||!dishes.length}>{busy?"Placing…":"Place order"}</button>{message&&<div className="notice">{message}</div>}</form>;
}
