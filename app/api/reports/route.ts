import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
export async function GET(){
  const [sales,topDishes]=await Promise.all([
    pool.query("SELECT r.restaurant_id,r.name,COUNT(DISTINCT o.order_id)::int order_count,COALESCE(SUM(o.total) FILTER(WHERE o.status='delivered'),0)::numeric(12,2) delivered_sales FROM restaurants r LEFT JOIN orders o USING(restaurant_id) GROUP BY r.restaurant_id ORDER BY delivered_sales DESC"),
    pool.query("SELECT r.restaurant_id,r.name restaurant,m.item_id,m.name dish,SUM(oi.quantity)::int quantity_sold FROM order_items oi JOIN orders o USING(order_id) JOIN menu_items m USING(item_id) JOIN restaurants r ON r.restaurant_id=o.restaurant_id WHERE o.status='delivered' GROUP BY r.restaurant_id,r.name,m.item_id,m.name ORDER BY quantity_sold DESC LIMIT 10")
  ]);
  return NextResponse.json({salesByRestaurant:sales.rows,topDishes:topDishes.rows});
}
