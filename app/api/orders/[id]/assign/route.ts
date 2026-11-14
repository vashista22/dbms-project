import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { apiError, rollbackQuietly } from "@/lib/api-errors";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { partner_id?: number };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const partnerId = body?.partner_id;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(partnerId) || partnerId! <= 0) {
    return NextResponse.json({ error: "Provide a valid order ID and partner ID." }, { status: 400 });
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const order = await client.query(
      `SELECT o.order_id, o.status, r.city FROM orders o
       JOIN restaurants r USING (restaurant_id) WHERE o.order_id=$1 FOR UPDATE OF o`, [Number(id)]);
    if (!order.rowCount) throw new Error("Order not found.");
    if (order.rows[0].status !== "placed") throw new Error("Only placed orders can be assigned.");

    // Locking the partner row serializes competing assignments of this partner across different orders.
    const partner = await client.query(
      `SELECT partner_id FROM delivery_partners
       WHERE partner_id=$1 AND city=$2 AND status='available' FOR UPDATE`,
      [partnerId, order.rows[0].city]);
    if (!partner.rowCount) throw new Error("Partner is unavailable or in another city.");

    await client.query("UPDATE orders SET partner_id=$1,status='accepted' WHERE order_id=$2", [partnerId, Number(id)]);
    const updatedPartner = await client.query(
      "UPDATE delivery_partners SET status='busy' WHERE partner_id=$1 AND status='available' RETURNING partner_id", [partnerId]);
    if (!updatedPartner.rowCount) throw new Error("Partner was assigned to another order. Please choose an available partner.");
    await client.query("COMMIT");
    return NextResponse.json({ order_id: Number(id), partner_id: partnerId, status: "accepted" });
  } catch (error) {
    if (transactionStarted) await rollbackQuietly(sql => client.query(sql));
    return apiError(error, "Assignment failed.", 409);
  } finally {
    client.release();
  }
}
