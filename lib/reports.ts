import { pool } from "@/lib/db";
import { rollbackQuietly } from "@/lib/api-errors";

export type ReportDefinition = {
  name: string;
  title: string;
  concepts: string;
  explanation: string;
  sql: string;
};

export type ReportResult = {
  name: string;
  title: string;
  concepts: string;
  explanation: string;
  sql: string;
  rows: Record<string, unknown>[];
};

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    name: "restaurant-sales",
    title: "1. Restaurant Sales Summary",
    concepts: "View (view_restaurant_sales) · LEFT JOIN · Aggregate SUM/COUNT",
    explanation: "Shows each restaurant's delivered order count, revenue, and average order value, including restaurants with zero deliveries.",
    sql: `SELECT v.restaurant_id, v.restaurant_name, v.city,
       v.total_orders::int AS delivered_order_count,
       v.total_revenue::numeric(12,2) AS delivered_revenue,
       COALESCE(ROUND(v.total_revenue / NULLIF(v.total_orders, 0), 2), 0)::numeric(10,2) AS avg_order_value
FROM view_restaurant_sales v
WHERE ($1::int IS NULL OR v.owner_id = $1)
ORDER BY delivered_revenue DESC, v.restaurant_name`,
  },
  {
    name: "top-dishes",
    title: "2. Top Selling Dishes",
    concepts: "View (view_top_dishes) · Multi-table JOIN · Deterministic Ranking",
    explanation: "Ranks top 10 dishes by units sold across delivered orders, filtered before ranking when scoped to an owner.",
    sql: `SELECT v.restaurant_id, v.restaurant_name, v.item_id, v.dish_name,
       m.is_veg, m.price::numeric(10,2) AS current_price,
       v.total_sold::int AS units_sold
FROM view_top_dishes v
JOIN menu_items m ON m.item_id = v.item_id
WHERE ($1::int IS NULL OR v.owner_id = $1)
ORDER BY units_sold DESC, v.restaurant_name, v.dish_name
LIMIT 10`,
  },
  {
    name: "high-value-customers",
    title: "3. High-Value Customers",
    concepts: "3-Table JOIN · GROUP BY · HAVING Aggregate Filter",
    explanation: "Finds customers with at least three delivered orders and strictly over ₹2,000 in delivered spend.",
    sql: `SELECT u.user_id, u.name AS customer_name,
       COUNT(o.order_id)::int AS order_count,
       SUM(o.total)::numeric(12,2) AS delivered_spend
FROM users u
JOIN orders o ON o.customer_id = u.user_id
JOIN restaurants r ON r.restaurant_id = o.restaurant_id
WHERE u.role = 'customer' AND o.status = 'delivered'
  AND ($1::int IS NULL OR r.owner_id = $1)
GROUP BY u.user_id, u.name
HAVING COUNT(o.order_id) >= 3 AND SUM(o.total) > 2000
ORDER BY delivered_spend DESC, u.name`,
  },
  {
    name: "above-average-customers",
    title: "4. Above-Average Customer Orders",
    concepts: "Correlated Subquery · Multi-table JOIN",
    explanation: "Lists delivered orders whose total exceeds that same customer's own average delivered order total.",
    sql: `SELECT o.order_id, u.user_id, u.name AS customer_name,
       r.name AS restaurant_name, o.total::numeric(10,2) AS total, o.placed_at,
       (SELECT ROUND(AVG(o2.total), 2)
        FROM orders o2
        WHERE o2.customer_id = o.customer_id AND o2.status = 'delivered')::numeric(10,2) AS customer_avg
FROM orders o
JOIN users u ON u.user_id = o.customer_id
JOIN restaurants r ON r.restaurant_id = o.restaurant_id
WHERE o.status = 'delivered'
  AND ($1::int IS NULL OR r.owner_id = $1)
  AND o.total > (
    SELECT AVG(other_order.total)
    FROM orders other_order
    WHERE other_order.customer_id = o.customer_id
      AND other_order.status = 'delivered'
  )
ORDER BY o.total DESC, o.order_id DESC
LIMIT 25`,
  },
  {
    name: "monthly-revenue",
    title: "5. Monthly Revenue Trend",
    concepts: "CTE (WITH) · View (view_restaurant_monthly_revenue) · Asia/Kolkata Month Truncation",
    explanation: "Summarizes delivered revenue and order counts by calendar month (Asia/Kolkata) using a CTE over view_restaurant_monthly_revenue.",
    sql: `WITH monthly_totals AS (
  SELECT v.month,
         SUM(v.revenue)::numeric(12,2) AS revenue,
         SUM(v.delivered_order_count)::int AS delivered_order_count,
         COUNT(DISTINCT v.restaurant_id)::int AS active_restaurants
  FROM view_restaurant_monthly_revenue v
  WHERE ($1::int IS NULL OR v.owner_id = $1)
  GROUP BY v.month
)
SELECT to_char(month, 'YYYY-MM') AS month,
       revenue,
       delivered_order_count,
       active_restaurants
FROM monthly_totals
ORDER BY month DESC`,
  },
];

/** Run all 5 reporting queries inside a single REPEATABLE READ READ ONLY snapshot transaction. */
export async function runReportsSnapshot(ownerId: number | null = null): Promise<ReportResult[]> {
  const client = await pool.connect();
  let txStarted = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    txStarted = true;

    const results: ReportResult[] = [];
    for (const def of REPORT_DEFINITIONS) {
      const res = await client.query(def.sql, [ownerId]);
      results.push({
        name: def.name,
        title: def.title,
        concepts: def.concepts,
        explanation: def.explanation,
        sql: def.sql,
        rows: res.rows,
      });
    }

    await client.query("COMMIT");
    txStarted = false;
    return results;
  } catch (error) {
    if (txStarted) await rollbackQuietly(sql => client.query(sql));
    throw error;
  } finally {
    client.release();
  }
}
