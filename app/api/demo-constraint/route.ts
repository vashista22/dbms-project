import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { rollbackQuietly } from "@/lib/api-errors";

type ScenarioId =
  | "invalid_transition"
  | "cross_restaurant_item"
  | "double_assignment"
  | "empty_order"
  | "undelivered_review"
  | "role_consistency"
  | "unavailable_item";

type PgError = Error & { code?: string; constraint?: string; detail?: string; where?: string };

export async function POST(request: NextRequest) {
  let body: { scenario?: ScenarioId };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const scenario = body?.scenario;
  if (!scenario) {
    return NextResponse.json({ error: "Provide a constraint scenario." }, { status: 400 });
  }

  const client = await pool.connect();
  let txStarted = false;
  let sqlAttempted = "";
  let expectedMechanism = "";

  try {
    await client.query("BEGIN");
    txStarted = true;

    if (scenario === "invalid_transition") {
      expectedMechanism = "Trigger: order_status_transition (BEFORE UPDATE ON orders)";
      const placed = await client.query("SELECT order_id, status FROM orders WHERE status = 'placed' LIMIT 1");
      const orderId = placed.rows[0]?.order_id ?? 1;
      sqlAttempted = `UPDATE orders SET status = 'delivered' WHERE order_id = ${orderId};`;
      await client.query("UPDATE orders SET status = 'delivered' WHERE order_id = $1", [orderId]);
    } else if (scenario === "cross_restaurant_item") {
      expectedMechanism = "Trigger: order_item_business_rules (BEFORE INSERT ON order_items)";
      const pair = await client.query(`
        SELECT o.order_id, o.restaurant_id AS order_rest, m.item_id, m.restaurant_id AS item_rest, m.price
        FROM orders o
        JOIN menu_items m ON m.restaurant_id <> o.restaurant_id AND m.is_available = true
        WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.order_id AND oi.item_id = m.item_id)
        LIMIT 1
      `);
      const row = pair.rows[0];
      if (!row) throw new Error("No suitable cross-restaurant item test pair found.");
      sqlAttempted = `INSERT INTO order_items(order_id, item_id, quantity, unit_price) VALUES (${row.order_id}, ${row.item_id}, 1, ${row.price}); -- order belongs to restaurant ${row.order_rest}, item belongs to ${row.item_rest}`;
      await client.query(
        "INSERT INTO order_items(order_id, item_id, quantity, unit_price) VALUES ($1, $2, 1, $3)",
        [row.order_id, row.item_id, row.price]
      );
    } else if (scenario === "double_assignment") {
      expectedMechanism = "Partial Unique Index: one_active_order_per_partner (ON orders(partner_id) WHERE status IN ('accepted','preparing','picked_up'))";
      const busy = await client.query(
        "SELECT partner_id, order_id FROM orders WHERE partner_id IS NOT NULL AND status IN ('accepted', 'preparing', 'picked_up') LIMIT 1"
      );
      const placed = await client.query("SELECT order_id FROM orders WHERE status = 'placed' LIMIT 1");
      if (!busy.rowCount || !placed.rowCount) {
        throw new Error("Need one busy partner and one placed order to demonstrate double assignment.");
      }
      const partnerId = busy.rows[0].partner_id;
      const orderId = placed.rows[0].order_id;
      sqlAttempted = `UPDATE orders SET partner_id = ${partnerId}, status = 'accepted' WHERE order_id = ${orderId}; -- partner ${partnerId} already holds active order #${busy.rows[0].order_id}`;
      await client.query("UPDATE orders SET partner_id = $1, status = 'accepted' WHERE order_id = $2", [
        partnerId,
        orderId,
      ]);
    } else if (scenario === "empty_order") {
      expectedMechanism = "Deferred Constraint Trigger: trigger_order_not_empty (DEFERRABLE INITIALLY DEFERRED)";
      const cust = await client.query("SELECT user_id, address_no FROM addresses LIMIT 1");
      const rest = await client.query("SELECT restaurant_id FROM restaurants WHERE is_open = true LIMIT 1");
      if (!cust.rowCount || !rest.rowCount) throw new Error("Missing customer address or restaurant.");
      sqlAttempted = `INSERT INTO orders(customer_id, address_no, restaurant_id, status, subtotal, delivery_fee, discount, total) VALUES (${cust.rows[0].user_id}, ${cust.rows[0].address_no}, ${rest.rows[0].restaurant_id}, 'placed', 0, 49, 0, 49); SET CONSTRAINTS trigger_order_not_empty IMMEDIATE;`;
      await client.query(
        `INSERT INTO orders(customer_id, address_no, restaurant_id, status, subtotal, delivery_fee, discount, total)
         VALUES ($1, $2, $3, 'placed', 0, 49, 0, 49)`,
        [cust.rows[0].user_id, cust.rows[0].address_no, rest.rows[0].restaurant_id]
      );
      await client.query("SET CONSTRAINTS trigger_order_not_empty IMMEDIATE");
    } else if (scenario === "undelivered_review") {
      expectedMechanism = "Trigger: review_only_after_delivery (BEFORE INSERT ON reviews)";
      const ord = await client.query("SELECT order_id, status FROM orders WHERE status <> 'delivered' LIMIT 1");
      if (!ord.rowCount) throw new Error("No non-delivered order found.");
      sqlAttempted = `INSERT INTO reviews(order_id, food_rating, delivery_rating, comment) VALUES (${ord.rows[0].order_id}, 5, 5, 'Premature review'); -- order status is '${ord.rows[0].status}'`;
      await client.query(
        "INSERT INTO reviews(order_id, food_rating, delivery_rating, comment) VALUES ($1, 5, 5, 'Premature review')",
        [ord.rows[0].order_id]
      );
    } else if (scenario === "role_consistency") {
      expectedMechanism = "Trigger: check_owner_role (BEFORE INSERT ON restaurants)";
      const cust = await client.query("SELECT user_id FROM users WHERE role = 'customer' LIMIT 1");
      if (!cust.rowCount) throw new Error("No customer user found.");
      sqlAttempted = `INSERT INTO restaurants(owner_id, name, city, address, is_open) VALUES (${cust.rows[0].user_id}, 'Fake Bistro', 'Hyderabad', 'Test Street', true); -- user ${cust.rows[0].user_id} has role 'customer'`;
      await client.query(
        "INSERT INTO restaurants(owner_id, name, city, address, is_open) VALUES ($1, 'Fake Bistro', 'Hyderabad', 'Test Street', true)",
        [cust.rows[0].user_id]
      );
    } else if (scenario === "unavailable_item") {
      expectedMechanism = "Trigger: order_item_business_rules (BEFORE INSERT ON order_items)";
      const unavail = await client.query(`
        SELECT o.order_id, m.item_id, m.name, m.price
        FROM menu_items m
        JOIN orders o ON o.restaurant_id = m.restaurant_id
        WHERE m.is_available = false
          AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.order_id AND oi.item_id = m.item_id)
        LIMIT 1
      `);
      if (!unavail.rowCount) throw new Error("No unavailable menu item pair found.");
      const r = unavail.rows[0];
      sqlAttempted = `INSERT INTO order_items(order_id, item_id, quantity, unit_price) VALUES (${r.order_id}, ${r.item_id}, 1, ${r.price}); -- '${r.name}' has is_available = FALSE`;
      await client.query(
        "INSERT INTO order_items(order_id, item_id, quantity, unit_price) VALUES ($1, $2, 1, $3)",
        [r.order_id, r.item_id, r.price]
      );
    } else {
      await rollbackQuietly(sql => client.query(sql));
      return NextResponse.json({ error: "Unknown constraint scenario." }, { status: 400 });
    }

    // If somehow no exception was raised, always roll back so seed data stays untouched.
    await rollbackQuietly(sql => client.query(sql));
    return NextResponse.json({
      scenario,
      rejected: false,
      sql_attempted: sqlAttempted,
      mechanism: expectedMechanism,
      message: "Unexpectedly succeeded without raising a constraint error.",
    });
  } catch (error) {
    if (txStarted) await rollbackQuietly(sql => client.query(sql));
    const pgErr = error as PgError;
    return NextResponse.json({
      scenario,
      rejected: true,
      pg_code: pgErr.code ?? "APP",
      constraint: pgErr.constraint ?? null,
      mechanism: expectedMechanism,
      sql_attempted: sqlAttempted,
      message: pgErr.message,
    });
  } finally {
    client.release();
  }
}
