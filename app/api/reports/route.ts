import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { apiError } from "@/lib/api-errors";

const reports = [
  {
    name: "restaurant-sales",
    explanation: "Shows each restaurant's delivered order count and revenue, including restaurants with no deliveries.",
    sql: `SELECT r.restaurant_id, r.name AS restaurant_name,
                 COUNT(o.order_id)::int AS delivered_order_count,
                 COALESCE(SUM(o.total), 0)::numeric(12,2) AS delivered_revenue
          FROM restaurants r LEFT JOIN orders o
            ON o.restaurant_id = r.restaurant_id AND o.status = 'delivered'
          GROUP BY r.restaurant_id, r.name
          ORDER BY delivered_revenue DESC, r.name`,
  },
  {
    name: "top-dishes",
    explanation: "Ranks dishes by units sold across delivered orders, grouped by restaurant and dish.",
    sql: `SELECT r.restaurant_id, r.name AS restaurant_name, m.item_id,
                 m.name AS dish_name, SUM(oi.quantity)::int AS units_sold
          FROM order_items oi JOIN orders o USING (order_id)
          JOIN menu_items m USING (item_id)
          JOIN restaurants r ON r.restaurant_id = o.restaurant_id
          WHERE o.status = 'delivered'
          GROUP BY r.restaurant_id, r.name, m.item_id, m.name
          ORDER BY units_sold DESC, r.name, m.name LIMIT 10`,
  },
  {
    name: "high-value-customers",
    explanation: "Finds customers with at least three delivered orders and over ₹2,000 in delivered spend.",
    sql: `SELECT u.user_id, u.name AS customer_name, COUNT(o.order_id)::int AS order_count,
                 SUM(o.total)::numeric(12,2) AS delivered_spend
          FROM users u JOIN orders o ON o.customer_id = u.user_id
          WHERE u.role = 'customer' AND o.status = 'delivered'
          GROUP BY u.user_id, u.name
          HAVING COUNT(o.order_id) >= 3 AND SUM(o.total) > 2000
          ORDER BY delivered_spend DESC`,
  },
  {
    name: "above-average-customers",
    explanation: "Lists delivered orders whose total exceeds that customer's own average delivered order.",
    sql: `SELECT o.order_id, u.user_id, u.name AS customer_name, o.total, o.placed_at
          FROM orders o JOIN users u ON u.user_id = o.customer_id
          WHERE o.status = 'delivered' AND o.total > (
            SELECT AVG(other_order.total) FROM orders other_order
            WHERE other_order.customer_id = o.customer_id AND other_order.status = 'delivered'
          )
          ORDER BY o.total DESC`,
  },
  {
    name: "monthly-revenue",
    explanation: "Summarizes delivered revenue by month with a CTE before joining each month to its order count.",
    sql: `WITH monthly_totals AS (
            SELECT date_trunc('month', placed_at)::date AS month,
                   SUM(total)::numeric(12,2) AS revenue,
                   COUNT(*)::int AS delivered_order_count
            FROM orders WHERE status = 'delivered'
            GROUP BY date_trunc('month', placed_at)::date
          )
          SELECT month, revenue, delivered_order_count
          FROM monthly_totals ORDER BY month DESC`,
  },
];

export async function GET() {
  try {
    const results = await Promise.all(reports.map(async ({ name, explanation, sql }) => {
      const result = await pool.query(sql);
      return { name, explanation, rows: result.rows };
    }));
    return NextResponse.json({ reports: results });
  } catch (error) {
    return apiError(error, "Reports could not be loaded.", 500);
  }
}
