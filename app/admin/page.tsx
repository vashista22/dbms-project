import { pool } from "@/lib/db";
import { runReportsSnapshot } from "@/lib/reports";
import ConstraintTester from "./constraint-tester";

export const dynamic = "force-dynamic";

type KpiRow = {
  total_records: number;
  delivered_orders: number;
  delivered_revenue: string;
  active_orders: number;
  open_restaurants: number;
  total_restaurants: number;
};

function formatCell(value: unknown, key: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Veg" : "Non-veg";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (key.includes("revenue") || key.includes("spend") || key.includes("avg") || key === "total" || key === "current_price") {
    return `₹${Number(value).toFixed(2)}`;
  }
  return String(value);
}

export default async function AdminPage() {
  const [kpiRes, reports] = await Promise.all([
    pool.query<KpiRow>(`
      SELECT
        (
          (SELECT COUNT(*) FROM users) +
          (SELECT COUNT(*) FROM addresses) +
          (SELECT COUNT(*) FROM restaurants) +
          (SELECT COUNT(*) FROM cuisines) +
          (SELECT COUNT(*) FROM restaurant_cuisines) +
          (SELECT COUNT(*) FROM menu_items) +
          (SELECT COUNT(*) FROM delivery_partners) +
          (SELECT COUNT(*) FROM coupons) +
          (SELECT COUNT(*) FROM orders) +
          (SELECT COUNT(*) FROM order_items) +
          (SELECT COUNT(*) FROM payments) +
          (SELECT COUNT(*) FROM reviews)
        )::int AS total_records,
        (SELECT COUNT(*)::int FROM orders WHERE status = 'delivered') AS delivered_orders,
        (SELECT COALESCE(SUM(total), 0)::numeric(12,2) FROM orders WHERE status = 'delivered') AS delivered_revenue,
        (SELECT COUNT(*)::int FROM orders WHERE status IN ('placed', 'accepted', 'preparing', 'picked_up')) AS active_orders,
        (SELECT COUNT(*)::int FROM restaurants WHERE is_open = true) AS open_restaurants,
        (SELECT COUNT(*)::int FROM restaurants) AS total_restaurants
    `),
    runReportsSnapshot(null),
  ]);

  const kpi = kpiRes.rows[0];

  return (
    <>
      <section className="intro">
        <h1>Admin Dashboard · SQL Reports &amp; DBMS Verification</h1>
        <p className="muted">
          All five non-trivial analytical queries execute in a single PostgreSQL{" "}
          <code>REPEATABLE READ READ ONLY</code> snapshot transaction backed by reporting views and partial indexes.
        </p>
      </section>

      <section className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total DB Records</div>
          <div className="kpi-value">{kpi.total_records}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Delivered Revenue</div>
          <div className="kpi-value">₹{Number(kpi.delivered_revenue).toFixed(2)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Delivered Orders</div>
          <div className="kpi-value">{kpi.delivered_orders}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Live Active Orders</div>
          <div className="kpi-value">{kpi.active_orders}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Open Restaurants</div>
          <div className="kpi-value">
            {kpi.open_restaurants} / {kpi.total_restaurants}
          </div>
        </div>
      </section>

      <ConstraintTester />

      {reports.map(report => {
        const columns = report.rows.length > 0 ? Object.keys(report.rows[0]) : [];
        return (
          <section className="panel" key={report.name}>
            <div className="card-header">
              <div>
                <h2>{report.title}</h2>
                <p className="muted">{report.explanation}</p>
              </div>
              <span className="badge blue">{report.concepts}</span>
            </div>

            <details>
              <summary>View SQL Query ({report.rows.length} rows returned)</summary>
              <pre className="sql-box">{report.sql}</pre>
            </details>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {columns.map(col => (
                      <th key={col}>{col.replace(/_/g, " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, idx) => (
                    <tr key={idx}>
                      {columns.map(col => (
                        <td key={col}>{formatCell(row[col], col)}</td>
                      ))}
                    </tr>
                  ))}
                  {report.rows.length === 0 && (
                    <tr>
                      <td className="muted">No matching rows for this report.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
