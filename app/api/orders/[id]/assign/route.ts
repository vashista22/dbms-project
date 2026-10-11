import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {id}=await params; const {partner_id}=await req.json();
  if(!/^\d+$/.test(id)||!Number.isInteger(partner_id)) return NextResponse.json({error:"Invalid order or partner."},{status:400});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const order=await client.query("SELECT o.order_id,o.status,r.city FROM orders o JOIN restaurants r USING(restaurant_id) WHERE o.order_id=$1 FOR UPDATE",[Number(id)]);
    if(!order.rowCount) throw new Error("Order not found.");
    if(order.rows[0].status!=="placed") throw new Error("Only placed orders can be assigned.");
    const partner=await client.query("SELECT partner_id FROM delivery_partners WHERE partner_id=$1 AND city=$2 AND status='available' FOR UPDATE",[partner_id,order.rows[0].city]);
    if(!partner.rowCount) throw new Error("Partner is unavailable or in another city.");
    await client.query("UPDATE orders SET partner_id=$1,status='accepted' WHERE order_id=$2",[partner_id,Number(id)]);
    await client.query("UPDATE delivery_partners SET status='busy' WHERE partner_id=$1",[partner_id]);
    await client.query("COMMIT"); return NextResponse.json({order_id:Number(id),partner_id,status:"accepted"});
  }catch(e){await client.query("ROLLBACK");return NextResponse.json({error:e instanceof Error?e.message:"Assignment failed."},{status:409});}finally{client.release();}
}
