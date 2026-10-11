import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
export async function GET(req: NextRequest) {
  const p=req.nextUrl.searchParams, values: unknown[]=[]; const filters:string[]=["r.is_open=true"];
  for(const [key,sql] of [["city","r.city ILIKE"],["cuisine","c.name ILIKE"]] as const){const v=p.get(key);if(v){values.push(`%${v}%`);filters.push(`${sql} $${values.length}`)}}
  const dishFilters=["m.restaurant_id=r.restaurant_id","m.is_available"];
  if(p.get("veg")==="true")dishFilters.push("m.is_veg");
  const minRaw=p.get("min_price"),maxRaw=p.get("max_price");
  const min=minRaw===null||minRaw===""?null:Number(minRaw),max=maxRaw===null||maxRaw===""?null:Number(maxRaw);
  if((min!==null&&(!Number.isFinite(min)||min<0))||(max!==null&&(!Number.isFinite(max)||max<0))||(min!==null&&max!==null&&min>max))return NextResponse.json({error:"Price range must be non-negative and minimum cannot exceed maximum."},{status:400});
  for(const [key,value] of [["min_price",min],["max_price",max]] as const){if(value!==null){values.push(value);const operator=key==="min_price"?">=":"<=";dishFilters.push(`m.price ${operator} $${values.length}`)}}
  if(p.get("veg")==="true"||p.has("min_price")||p.has("max_price"))filters.push(`EXISTS(SELECT 1 FROM menu_items m WHERE ${dishFilters.join(" AND ")})`);
  const q=await pool.query(`SELECT DISTINCT r.restaurant_id,r.name,r.city,r.avg_rating FROM restaurants r LEFT JOIN restaurant_cuisines rc USING(restaurant_id) LEFT JOIN cuisines c USING(cuisine_id) WHERE ${filters.join(" AND ")} ORDER BY r.name`,values);
  return NextResponse.json(q.rows);
}
