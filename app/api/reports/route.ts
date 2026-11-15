import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { runReportsSnapshot } from "@/lib/reports";

export async function GET(request: NextRequest) {
  const ownerRaw = request.nextUrl.searchParams.get("owner_id");
  let ownerId: number | null = null;
  if (ownerRaw !== null && ownerRaw !== "") {
    if (!/^\d+$/.test(ownerRaw) || Number(ownerRaw) <= 0) {
      return NextResponse.json({ error: "owner_id must be a positive integer." }, { status: 400 });
    }
    ownerId = Number(ownerRaw);
  }

  try {
    const results = await runReportsSnapshot(ownerId);
    return NextResponse.json({
      owner_id: ownerId,
      reports: results.map(({ name, title, concepts, explanation, rows }) => ({
        name,
        title,
        concepts,
        explanation,
        rows,
      })),
    });
  } catch (error) {
    return apiError(error, "Reports could not be loaded.", 500);
  }
}
