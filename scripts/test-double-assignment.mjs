import assert from "node:assert/strict";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const orderIds = [process.env.ORDER_ID_A, process.env.ORDER_ID_B];
const partnerId = Number(process.env.PARTNER_ID);
assert(orderIds.every(value => value && /^\d+$/.test(value)), "Set ORDER_ID_A and ORDER_ID_B to two placed orders in the same city.");
assert(Number.isSafeInteger(partnerId) && partnerId > 0, "Set PARTNER_ID to an available delivery partner in that city.");

const responses = await Promise.all(orderIds.map(orderId =>
  fetch(`${apiBaseUrl}/api/orders/${orderId}/assign`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ partner_id: partnerId }),
  }).then(async response => ({ status: response.status, body: await response.json() }))));

assert.equal(responses.filter(response => response.status === 200).length, 1,
  `Expected exactly one assignment to succeed; received ${responses.map(response => response.status).join(" and ")}.`);
assert.equal(responses.filter(response => response.status >= 400).length, 1,
  "The competing assignment must fail after the partner row lock is released.");
console.log("PASS: concurrent assignments did not assign one partner to two orders.");
