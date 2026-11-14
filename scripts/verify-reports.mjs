import assert from "node:assert/strict";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const response = await fetch(`${apiBaseUrl}/api/reports`);
const payload = await response.json();
assert.equal(response.status, 200, `Reports API returned ${response.status}: ${JSON.stringify(payload)}`);
const expectedNames = [
  "restaurant-sales", "top-dishes", "high-value-customers",
  "above-average-customers", "monthly-revenue",
];
assert.deepEqual(payload.reports.map(report => report.name).sort(), expectedNames.sort());
for (const report of payload.reports) {
  assert.equal(typeof report.explanation, "string");
  assert.ok(report.explanation.length > 0, `${report.name} must explain its result`);
  assert.ok(Array.isArray(report.rows), `${report.name} must return rows`);
}
console.log("PASS: all five report queries executed and returned explained result sets.");
