import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { apiError, rollbackQuietly } from "@/lib/api-errors";

type OrderItemInput = { item_id: number; quantity: number };
type OrderRequest = {
  customer_id: number; address_no: number; restaurant_id: number;
  items: OrderItemInput[]; payment_method: "upi" | "card" | "cod";
  coupon_code?: string | null;
};

export async function POST(request: NextRequest) {
  let body: OrderRequest;
  try { body = await request.json() as OrderRequest; }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }

  const { customer_id, address_no, restaurant_id, items, payment_method } = body ?? {};
  const couponCode = typeof body?.coupon_code === "string" ? body.coupon_code.trim().toUpperCase() : null;
  const validPaymentMethods = ["upi", "card", "cod"];
  if (!Number.isInteger(customer_id) || !Number.isInteger(address_no) || !Number.isInteger(restaurant_id) ||
      !Array.isArray(items) || items.length === 0 || items.length > 50 ||
      !validPaymentMethods.includes(payment_method) ||
      (body.coupon_code != null && (typeof body.coupon_code !== "string" || couponCode!.length === 0 || couponCode!.length > 50))) {
    return NextResponse.json({ error: "Invalid order details." }, { status: 400 });
  }
  if (items.some(item => !item || !Number.isInteger(item.item_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) ||
      new Set(items.map(item => item.item_id)).size !== items.length) {
    return NextResponse.json({ error: "Each item must be listed once with a quantity from 1 to 20." }, { status: 400 });
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const address = await client.query("SELECT 1 FROM addresses WHERE user_id=$1 AND address_no=$2", [customer_id, address_no]);
    if (!address.rowCount) throw new Error("Choose an address belonging to this customer.");
    const restaurant = await client.query("SELECT 1 FROM restaurants WHERE restaurant_id=$1 AND is_open FOR SHARE", [restaurant_id]);
    if (!restaurant.rowCount) throw new Error("Restaurant is closed or unavailable.");

    let subtotalCents = 0;
    const orderItems: { item_id: number; quantity: number; unit_price: number }[] = [];
    for (const item of items) {
      const result = await client.query("SELECT price FROM menu_items WHERE item_id=$1 AND restaurant_id=$2 AND is_available FOR SHARE", [item.item_id, restaurant_id]);
      if (!result.rowCount) throw new Error("An item is unavailable or belongs to another restaurant.");
      const unitPrice = Number(result.rows[0].price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("A menu item has an invalid price.");
      subtotalCents += Math.round(unitPrice * 100) * item.quantity;
      orderItems.push({ item_id: item.item_id, quantity: item.quantity, unit_price: unitPrice });
    }

    const deliveryFeeCents = 4900;
    let discountCents = 0;
    if (couponCode) {
      const result = await client.query(
        `SELECT discount_pct, max_discount, min_order FROM coupons
         WHERE code=$1 AND CURRENT_DATE BETWEEN valid_from AND valid_to FOR SHARE`, [couponCode]);
      if (!result.rowCount) throw new Error("Coupon is invalid, not yet active, or expired.");
      const coupon = result.rows[0];
      if (subtotalCents < Math.round(Number(coupon.min_order) * 100)) throw new Error("Order does not meet the coupon minimum.");
      const percentageDiscount = Math.floor(subtotalCents * Number(coupon.discount_pct) / 100 + 0.5);
      const maximumDiscount = coupon.max_discount == null ? subtotalCents : Math.round(Number(coupon.max_discount) * 100);
      discountCents = Math.min(percentageDiscount, maximumDiscount, subtotalCents);
    }

    const subtotal = subtotalCents / 100;
    const deliveryFee = deliveryFeeCents / 100;
    const discount = discountCents / 100;
    const total = (subtotalCents + deliveryFeeCents - discountCents) / 100;
    const order = await client.query(
      `INSERT INTO orders(customer_id,address_no,restaurant_id,coupon_code,status,subtotal,delivery_fee,discount,total)
       VALUES($1,$2,$3,$4,'placed',$5,$6,$7,$8) RETURNING order_id`,
      [customer_id, address_no, restaurant_id, couponCode, subtotal, deliveryFee, discount, total]);
    const orderId: number = order.rows[0].order_id;

    for (const item of orderItems) {
      await client.query("INSERT INTO order_items(order_id,item_id,quantity,unit_price) VALUES($1,$2,$3,$4)",
        [orderId, item.item_id, item.quantity, item.unit_price]);
    }
    await client.query("INSERT INTO payments(order_id,amount,method,status) VALUES($1,$2,$3,$4)",
      [orderId, total, payment_method, payment_method === "cod" ? "initiated" : "completed"]);
    await client.query("COMMIT");
    return NextResponse.json({ order_id: orderId, subtotal, delivery_fee: deliveryFee, discount, total }, { status: 201 });
  } catch (error) {
    if (transactionStarted) await rollbackQuietly(sql => client.query(sql));
    return apiError(error, "Order could not be placed.", 400);
  } finally {
    client.release();
  }
}
