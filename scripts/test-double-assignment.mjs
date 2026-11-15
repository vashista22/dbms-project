import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const explicitIds = [process.env.ORDER_ID_A, process.env.ORDER_ID_B];
const explicitPartner = Number(process.env.PARTNER_ID);

let createdOrderIds = [];
let createdPartnerId = null;
let pool = null;

try {
  let orderIds = explicitIds;
  let partnerId = explicitPartner;

  if (!explicitIds.every(v => v && /^\d+$/.test(v)) || !Number.isSafeInteger(partnerId) || partnerId <= 0) {
    const connectionString = loadDatabaseUrl();
    assert(connectionString, "Set DATABASE_URL (or .env) or provide ORDER_ID_A, ORDER_ID_B, PARTNER_ID.");
    pool = new Pool({ connectionString });

    const setupRes = await pool.query(`
      SELECT dp.partner_id, r.restaurant_id, r.city, m.item_id, m.price, a.user_id AS customer_id, a.address_no
      FROM delivery_partners dp
      JOIN restaurants r ON r.city = dp.city AND r.is_open = true
      JOIN menu_items m ON m.restaurant_id = r.restaurant_id AND m.is_available = true
      JOIN addresses a ON a.user_id IN (SELECT user_id FROM users WHERE role = 'customer')
      WHERE dp.status = 'available'
      LIMIT 1
    `);
    assert(setupRes.rowCount > 0, "Need an available partner, open restaurant with an available item, and customer address.");
    const row = setupRes.rows[0];
    partnerId = row.partner_id;
    createdPartnerId = partnerId;

    // Create two placed orders in separate committed transactions so concurrent assign requests can race on them.
    for (let i = 0; i < 2; i++) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const total = Number(row.price) + 49;
        const ord = await client.query(
          `INSERT INTO orders(customer_id, address_no, restaurant_id, status, subtotal, delivery_fee, discount, total)
           VALUES ($1, $2, $3, 'placed', $4, 49, 0, $5)
           RETURNING order_id`,
          [row.customer_id, row.address_no, row.restaurant_id, row.price, total]
        );
        const oid = ord.rows[0].order_id;
        await client.query(
          "INSERT INTO order_items(order_id, item_id, quantity, unit_price) VALUES ($1, $2, 1, $3)",
          [oid, row.item_id, row.price]
        );
        await client.query("COMMIT");
        createdOrderIds.push(oid);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    orderIds = createdOrderIds.map(String);
  }

  const responses = await Promise.all(
    orderIds.map(orderId =>
      fetch(`${apiBaseUrl}/api/orders/${orderId}/assign`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partner_id: partnerId }),
      }).then(async response => ({ orderId, status: response.status, body: await response.json() }))
    )
  );

  const succeeded = responses.filter(r => r.status === 200);
  const failed = responses.filter(r => r.status >= 400);
  assert.equal(
    succeeded.length,
    1,
    `Expected exactly 1 assignment to succeed; got ${JSON.stringify(responses)}.`
  );
  assert.equal(
    failed.length,
    1,
    `Expected competing assignment to fail; got ${JSON.stringify(responses)}.`
  );
  console.log(
    `PASS: concurrent assignment test on partner #${partnerId} for orders [${orderIds.join(", ")}] -> 1 succeeded (200), 1 rejected (${failed[0].status}: ${failed[0].body.error}).`
  );
} finally {
  if (pool && createdOrderIds.length > 0) {
    await pool.query("DELETE FROM orders WHERE order_id = ANY($1::int[])", [createdOrderIds]);
    if (createdPartnerId) {
      await pool.query("UPDATE delivery_partners SET status = 'available' WHERE partner_id = $1", [createdPartnerId]);
    }
    await pool.end();
  }
}
