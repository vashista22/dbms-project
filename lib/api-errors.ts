import { NextResponse } from "next/server";

type PgError = Error & { code?: string; constraint?: string; detail?: string };

/** Convert PostgreSQL business-rule and constraint failures into safe, readable API responses. */
export function apiError(error: unknown, fallback: string, status = 400) {
  if (error instanceof Error && !("code" in error)) {
    return NextResponse.json({ error: error.message || fallback }, { status });
  }

  const dbError: PgError | {} = error && typeof error === "object" ? error as PgError : {};
  const triggerMessage = "message" in dbError ? dbError.message : undefined;
  let message = fallback;
  switch ("code" in dbError ? dbError.code : undefined) {
    case "P0001": // RAISE EXCEPTION from a project business-rule trigger
      message = triggerMessage || "The requested change violates a business rule.";
      break;
    case "23505": message = "That record already exists."; break;
    case "23503": message = "The referenced record does not exist or is still in use."; break;
    case "23514": message = triggerMessage || "The submitted values violate a database rule."; break;
    case "23502": message = "A required value is missing."; break;
    case "40001":
    case "40P01": message = "The request conflicted with another update. Please retry."; break;
    default: break;
  }
  return NextResponse.json({ error: message }, { status });
}

export async function rollbackQuietly(query: (sql: string) => Promise<unknown>) {
  try { await query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
}
