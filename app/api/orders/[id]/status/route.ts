import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { apiError, rollbackQuietly } from "@/lib/api-errors";

const allowedStatuses = ["preparing", "picked_up", "delivered", "cancelled"];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { status?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!/^\d+$/.test(id) || !allowedStatuses.includes(body?.status ?? "")) {
    return NextResponse.json({ error: "Provide a valid order ID and next status." }, { status: 400 });
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query(
      `UPDATE orders SET status=$1,
         delivered_at=CASE WHEN $1='delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END
       WHERE order_id=$2 RETURNING order_id,status,partner_id`, [body.status, Number(id)]);
    if (!result.rowCount) {
      await rollbackQuietly(sql => client.query(sql));
      transactionStarted = false;
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    if (["delivered", "cancelled"].includes(body.status!) && result.rows[0].partner_id) {
      await client.query("UPDATE delivery_partners SET status='available' WHERE partner_id=$1", [result.rows[0].partner_id]);
    }
    await client.query("COMMIT");
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    if (transactionStarted) await rollbackQuietly(sql => client.query(sql));
    return apiError(error, "Status update failed.", 409);
  } finally {
    client.release();
  }
}
