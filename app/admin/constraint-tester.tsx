"use client";

import { useState } from "react";

type TestResult = {
  scenario: string;
  rejected: boolean;
  pg_code?: string;
  constraint?: string | null;
  mechanism: string;
  sql_attempted: string;
  message: string;
};

const SCENARIOS = [
  {
    id: "invalid_transition",
    label: "1. Invalid Status Jump (placed → delivered)",
    hint: "Tests trigger order_status_transition",
  },
  {
    id: "cross_restaurant_item",
    label: "2. Cross-Restaurant Item Injection",
    hint: "Tests trigger order_item_business_rules",
  },
  {
    id: "double_assignment",
    label: "3. Double Partner Assignment (Busy Partner)",
    hint: "Tests partial unique index one_active_order_per_partner",
  },
  {
    id: "empty_order",
    label: "4. Empty Order Commit (0 Items)",
    hint: "Tests deferred trigger trigger_order_not_empty",
  },
  {
    id: "undelivered_review",
    label: "5. Review Non-Delivered Order",
    hint: "Tests trigger review_only_after_delivery",
  },
  {
    id: "role_consistency",
    label: "6. Customer Owning Restaurant (Role Violation)",
    hint: "Tests trigger check_owner_role",
  },
  {
    id: "unavailable_item",
    label: "7. Order Unavailable Dish",
    hint: "Tests trigger order_item_business_rules",
  },
];

export default function ConstraintTester() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");

  async function runScenario(id: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch("/api/demo-constraint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Test call failed.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Could not reach server.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel" style={{ marginBottom: 22 }}>
      <h2>Live DBMS Constraint &amp; Trigger Demonstration</h2>
      <p className="muted">
        Click any rule below to execute a deliberate violating SQL statement inside a PostgreSQL transaction (rolled
        back cleanly) and inspect the exact database trigger / constraint error raised by PostgreSQL.
      </p>

      <div className="chip-list" style={{ marginTop: 12 }}>
        {SCENARIOS.map(s => (
          <button
            key={s.id}
            type="button"
            className="outline sm"
            title={s.hint}
            disabled={busyId !== null}
            onClick={() => runScenario(s.id)}
          >
            {busyId === s.id ? "Testing…" : s.label}
          </button>
        ))}
      </div>

      {error && <div className="notice error">{error}</div>}

      {result && (
        <div className={result.rejected ? "notice" : "notice error"} style={{ marginTop: 14 }}>
          <div>
            <strong>
              {result.rejected
                ? `BLOCKED BY POSTGRESQL (${result.pg_code}${result.constraint ? ` · ${result.constraint}` : ""})`
                : "NOT BLOCKED"}
            </strong>
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Mechanism:</strong> {result.mechanism}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>DB Error Message:</strong> <code>{result.message}</code>
          </div>
          <pre className="sql-box">{result.sql_attempted}</pre>
        </div>
      )}
    </section>
  );
}
