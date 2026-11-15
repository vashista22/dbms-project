import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { apiError } from "@/lib/api-errors";

export async function POST(request: NextRequest) {
  let body: {
    customer_id?: number;
    order_id?: number;
    food_rating?: number;
    delivery_rating?: number;
    comment?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { customer_id, order_id, food_rating, delivery_rating, comment } = body ?? {};
  if (
    !Number.isInteger(customer_id) || customer_id! <= 0 ||
    !Number.isInteger(order_id) || order_id! <= 0 ||
    ![food_rating, delivery_rating].every(rating => Number.isInteger(rating) && rating! >= 1 && rating! <= 5) ||
    typeof comment !== "string" || comment.length > 1000
  ) {
    return NextResponse.json({ error: "Invalid review details." }, { status: 400 });
  }

  try {
    const order = await pool.query(
      "SELECT status FROM orders WHERE order_id = $1 AND customer_id = $2",
      [order_id, customer_id]
    );
    if (!order.rowCount) {
      return NextResponse.json({ error: "Order not found for the selected customer." }, { status: 403 });
    }
    if (order.rows[0].status !== "delivered") {
      return NextResponse.json({ error: "Only delivered orders can be reviewed." }, { status: 409 });
    }

    const review = await pool.query(
      `INSERT INTO reviews(order_id, food_rating, delivery_rating, comment)
       VALUES($1, $2, $3, $4)
       RETURNING order_id, food_rating, delivery_rating, comment, created_at`,
      [order_id, food_rating, delivery_rating, comment.trim() || null]
    );
    return NextResponse.json(review.rows[0], { status: 201 });
  } catch (error) {
    const response = apiError(error, "Review could not be saved.", 409);
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "This order already has a review." }, { status: 409 });
    }
    return response;
  }
}
