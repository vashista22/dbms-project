import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { apiError, rollbackQuietly } from "@/lib/api-errors";

const allowedStatuses = ["preparing", "picked_up", "delivered", "cancelled"];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!/^\d+$/.test(id) || !allowedStatuses.includes(body?.status ?? "")) {
    return NextResponse.json({ error: "Provide a valid order ID and next status." }, { status: 400 });
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const existing = await client.query(
      "SELECT order_id, status, partner_id FROM orders WHERE order_id = $1 FOR UPDATE",
      [Number(id)]
    );
    if (!existing.rowCount) {
      await rollbackQuietly(sql => client.query(sql));
      transactionStarted = false;
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    // Idempotent retry at the same status returns the current row without altering partner availability.
    if (existing.rows[0].status === body.status) {
      await client.query("COMMIT");
      return NextResponse.json(existing.rows[0]);
    }

    const result = await client.query(
      `UPDATE orders
       SET status = $1,
           delivered_at = CASE WHEN $3::boolean THEN COALESCE(delivered_at, CURRENT_TIMESTAMP) ELSE delivered_at END
       WHERE order_id = $2
       RETURNING order_id, status, partner_id, delivered_at`,
      [body.status, Number(id), body.status === "delivered"]
    );

    if (body.status === "delivered") {
      await client.query(
        `UPDATE payments
         SET status = 'completed', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
         WHERE order_id = $1 AND method = 'cod' AND status = 'initiated'`,
        [Number(id)]
      );
    } else if (body.status === "cancelled") {
      await client.query(
        `UPDATE payments
         SET status = CASE WHEN method = 'cod' THEN 'failed' ELSE 'refunded' END
         WHERE order_id = $1 AND status IN ('initiated', 'completed')`,
        [Number(id)]
      );
    }

    if (["delivered", "cancelled"].includes(body.status!) && result.rows[0].partner_id) {
      await client.query(
        "UPDATE delivery_partners SET status = 'available' WHERE partner_id = $1",
        [result.rows[0].partner_id]
      );
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
