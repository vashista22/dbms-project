import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
type Item={item_id:number;quantity:number};
export async function POST(req:NextRequest){
  const body=await req.json(); const {customer_id,address_no,restaurant_id,items,payment_method,coupon_code}=body as {customer_id:number;address_no:number;restaurant_id:number;items:Item[];payment_method:"upi"|"card"|"cod";coupon_code?:string|null};
  if(!Number.isInteger(customer_id)||!Number.isInteger(address_no)||!Number.isInteger(restaurant_id)||!Array.isArray(items)||!items.length||!(["upi","card","cod"] as string[]).includes(payment_method))return NextResponse.json({error:"Invalid order details."},{status:400});
  const client=await pool.connect();
  try { await client.query("BEGIN");
    const address=await client.query("SELECT 1 FROM addresses WHERE user_id=$1 AND address_no=$2",[customer_id,address_no]); if(!address.rowCount)throw new Error("Choose an address belonging to this customer.");
    const restaurant=await client.query("SELECT 1 FROM restaurants WHERE restaurant_id=$1 AND is_open",[restaurant_id]);if(!restaurant.rowCount)throw new Error("Restaurant is closed or unavailable.");
    let subtotalCents=0; const rows=[] as {item_id:number;quantity:number;price:number}[];
    for(const item of items){if(!Number.isInteger(item.item_id)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>20)throw new Error("Invalid item quantity."); const q=await client.query("SELECT price FROM menu_items WHERE item_id=$1 AND restaurant_id=$2 AND is_available FOR SHARE",[item.item_id,restaurant_id]);if(!q.rowCount)throw new Error("An item is unavailable or belongs to another restaurant.");const price=Number(q.rows[0].price);subtotalCents+=Math.round(price*100)*item.quantity;rows.push({item_id:item.item_id,quantity:item.quantity,price});}
    const subtotal=subtotalCents/100, fee=49; let discountCents=0; let coupon: string|null=null;
    if(coupon_code){const q=await client.query("SELECT discount_pct,max_discount,min_order FROM coupons WHERE code=$1 AND CURRENT_DATE BETWEEN valid_from AND valid_to",[coupon_code]);if(!q.rowCount)throw new Error("Coupon is invalid or expired.");const c=q.rows[0];if(subtotal<Number(c.min_order))throw new Error("Order does not meet the coupon minimum.");const percentDiscountCents=Math.round(subtotalCents*Number(c.discount_pct)/100);discountCents=Math.min(percentDiscountCents,c.max_discount==null?subtotalCents:Math.round(Number(c.max_discount)*100));coupon=coupon_code;}
    const discount=discountCents/100,total=Math.max(0,(subtotalCents+4900-discountCents)/100); const order=await client.query("INSERT INTO orders(customer_id,address_no,restaurant_id,coupon_code,status,subtotal,delivery_fee,discount,total) VALUES($1,$2,$3,$4,'placed',$5,$6,$7,$8) RETURNING order_id",[customer_id,address_no,restaurant_id,coupon,subtotal,fee,discount,total]);const id=order.rows[0].order_id;
    for(const row of rows)await client.query("INSERT INTO order_items(order_id,item_id,quantity,unit_price) VALUES($1,$2,$3,$4)",[id,row.item_id,row.quantity,row.price]);
    await client.query("INSERT INTO payments(order_id,amount,method,status) VALUES($1,$2,$3,$4)",[id,total,payment_method,payment_method==="cod"?"initiated":"completed"]);
    await client.query("COMMIT");return NextResponse.json({order_id:id,total},{status:201});
  }catch(e){await client.query("ROLLBACK");return NextResponse.json({error:e instanceof Error?e.message:"Order failed."},{status:400});}finally{client.release();}
}
