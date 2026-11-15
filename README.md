# QuickBite — Swiggy-Style Food Delivery System

**CS F212 Database Systems — Final Course Project (Group-12 / P2)**  
**Repository:** https://github.com/vashista22/dbms-project  
**Submission Tag:** `final` · **Code Commit:** `8ee85e1` (`8ee85e1f39b5eb560146b5aea330aa1b9e1db15e`)

QuickBite is a full-stack relational database application modeling a Swiggy-style multi-restaurant food delivery platform built directly on **PostgreSQL 18** and **Next.js 15 (App Router)** using the **`pg` (`node-postgres`)** driver with raw parameterized SQL queries and explicit transaction management (no ORM).

---

## Team Members

| Name | BITS ID | Focus Areas |
| :--- | :--- | :--- |
| **Vashista Vasantharao** | `2023A8PS0439H` | Normalized 12-table PostgreSQL DDL (`schema.sql`, `db/integrity.sql`), 11 PL/pgSQL business-rule & role triggers, 3 reporting views, 8 search/partial indexes, and `EXPLAIN (ANALYZE, BUFFERS)` query plan analysis |
| **Anirudh Peddinti** | `2023AAPS0192H` | Next.js App Router scaffold, transactional checkout (`POST /api/orders`), `FOR UPDATE` partner locking (`PATCH /api/orders/[id]/assign`), status/payment settlement (`PATCH /api/orders/[id]/status`), `REPEATABLE READ` analytical reports (`lib/reports.ts`, `/api/reports`), PG error mapping (`lib/api-errors.ts`), concurrent double-assignment test |
| **Aayush Rastogi** | `2023B2A30888H` | Customer (`/`), Owner (`/owner`), Partner (`/partner`), and Admin (`/admin`) dashboards, live constraint failure tester (`/api/demo-constraint`), Database Design Document, and Demo Sheet |
| **Sri Niketh Mulagada** | `2023B2A80941H` | Deterministic 1,151-row dataset generator (`db/generate_seed.py`, `db/seed_full.sql`) adhering to legal trigger transitions, responsive UI styling & empty/loading states (`app/styles.css`), end-to-end QA verification, and `README.md` |

---

## Technology Stack & Architecture

```
Next.js 15 App Router (Server + Client React 19 UI)
   ├── /          Customer Portal (restaurant discovery, menu filters, transactional checkout, review submission)
   ├── /owner     Restaurant Owner Dashboard (open/close store, menu editor, partner assignment, owner analytics)
   ├── /partner   Delivery Partner Portal (accepted -> preparing -> picked_up -> delivered lifecycle)
   └── /admin     Admin Dashboard (platform-wide analytics + 7 live DB constraint failure demonstrations)
         │
         ▼
Next.js API Routes (/app/api/*) + node-postgres (pg Pool, raw parameterized SQL, explicit BEGIN/COMMIT/ROLLBACK)
         │
         ▼
PostgreSQL 18 (12 BCNF tables · 1,151 seeded rows · 3 views · 8 indexes · 11 triggers)
```

---

## Database Schema Overview (`schema.sql`)

| # | Relation | Type | Key Highlights | Seeded Rows |
| :-: | :--- | :--- | :--- | :---: |
| 1 | `users` | Strong entity | `user_id PK`, unique `email` & `phone`, `role IN ('customer','owner','partner','admin')` | 50 |
| 2 | `addresses` | Weak entity | Composite PK `(user_id, address_no)`, FK `user_id -> users ON DELETE CASCADE` | 65 |
| 3 | `restaurants` | Strong entity | `owner_id -> users`, cached `avg_rating` maintained by `trigger_sync_rating` | 15 |
| 4 | `cuisines` | Lookup entity | `cuisine_id PK`, unique `name` | 8 |
| 5 | `restaurant_cuisines` | M:N junction | Composite PK `(restaurant_id, cuisine_id)` | 31 |
| 6 | `menu_items` | Entity | `restaurant_id -> restaurants ON DELETE CASCADE`, `CHECK (price >= 0)` | 150 |
| 7 | `delivery_partners` | EER subclass of `users` | `partner_id PK & FK -> users`, unique `vehicle_no`, `status IN ('offline','available','busy')` | 10 |
| 8 | `coupons` | Promotion catalog | `code PK`, `CHECK (discount_pct BETWEEN 1 AND 100)`, `CHECK (valid_from <= valid_to)` | 5 |
| 9 | `orders` | Core transactional | Composite FK `(customer_id, address_no) -> addresses`, partial unique index `one_active_order_per_partner` | 160 |
| 10 | `order_items` | Order line items | Composite PK `(order_id, item_id)`, historical `unit_price` snapshot | 400 |
| 11 | `payments` | 1:1 with `orders` | `order_id UK & FK ON DELETE CASCADE`, `method IN ('upi','card','cod')`, `status IN ('initiated','completed','failed','refunded')` | 160 |
| 12 | `reviews` | 1:1 delivered reviews | `order_id PK & FK ON DELETE CASCADE`, `food_rating` & `delivery_rating` `BETWEEN 1 AND 5` | 97 |
| | **Total** | **12 BCNF relations** | **All tables satisfy 3NF / BCNF** | **1,151** |

### Reporting Views, Indexes & Triggers

- **Views (`schema.sql:142-181`):** `view_restaurant_sales`, `view_top_dishes`, `view_restaurant_monthly_revenue`
- **Indexes (`schema.sql:188-206`):**
  - Partial Unique: `one_active_order_per_partner` (`orders(partner_id) WHERE partner_id IS NOT NULL AND status IN ('accepted','preparing','picked_up')`)
  - Search/Filter B-Tree: `idx_restaurants_city`, `idx_cuisines_name`, `idx_menu_items_is_veg`, `idx_menu_items_price`, `idx_orders_status`
  - Partial Reporting: `idx_delivered_customer (customer_id, total)` and `idx_delivered_restaurant (restaurant_id, placed_at)` (`WHERE status = 'delivered'`)
- **Triggers (`schema.sql:213-411`):** `check_owner_role`, `check_partner_role`, `check_customer_role`, `trigger_sync_rating`, `trigger_order_not_empty` (`DEFERRABLE INITIALLY DEFERRED`), `trigger_remaining_order_items` (`DEFERRABLE INITIALLY DEFERRED`), `order_item_business_rules`, `order_restaurant_scope`, `menu_item_restaurant_scope`, `order_status_transition`, `review_only_after_delivery`

---

## Application Workflows

1. **Customer Browse & Transactional Checkout (`/` & `POST /api/orders`):** Filter open restaurants by city, cuisine, veg-only flag, and dish price range (`GET /api/restaurants`); select address, menu items, optional coupon, and payment method (`upi`, `card`, `cod`). A single explicit `BEGIN ... COMMIT` transaction locks rows with `FOR SHARE`, verifies ownership and coupon window/minimum, performs integer-paise arithmetic, snapshots item prices into `order_items`, and inserts `orders` + `payments` (`initiated` for COD, `completed` otherwise).
2. **Restaurant Owner Menu, Order Assignment & Analytics (`/owner` & `PATCH /api/orders/[id]/assign`):** Owners toggle store open status (`PATCH /api/restaurants`), add or edit menu availability/prices (`POST`/`PATCH /api/menu-items`), cancel pre-pickup orders (`cancelled` refunds prepaid or fails COD), and assign same-city available delivery partners using `FOR UPDATE` row locks serialized against `one_active_order_per_partner`. Owners view live metrics scoped to their restaurants from `/api/reports`.
3. **Delivery State Machine, Payment Settlement & Reviews (`/partner`, `/`, `/admin`):** Delivery partners transition assigned orders strictly along `accepted -> preparing -> picked_up -> delivered` (`PATCH /api/orders/[id]/status`). On delivery, triggers timestamp `delivered_at`, COD payments settle to `completed`, and the partner returns to `available`. Customers rate delivered orders (`POST /api/reviews`), triggering `trigger_sync_rating` to update `restaurants.avg_rating`. Admins can run 7 live rolled-back constraint demonstrations on `/admin`.

---

## Non-Trivial SQL Queries (`lib/reports.ts`)

Executed together inside a single `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY ... COMMIT` snapshot via `/api/reports`:

1. **`restaurant-sales`:** Joins `view_restaurant_sales` with safe `NULLIF` division to compute delivered orders, delivered revenue, and average order value per restaurant (including zero-order stores).
2. **`top-dishes`:** Joins `view_top_dishes` with `menu_items` and ranks the top 10 selling dishes by total delivered quantity.
3. **`high-value-customers`:** 3-table join (`users`, `orders`, `restaurants`) with `GROUP BY` and `HAVING COUNT(o.order_id) >= 3 AND SUM(o.total) > 2000`.
4. **`above-average-customers`:** Correlated subquery comparing each delivered order's total against that customer's own average delivered spend.
5. **`monthly-revenue`:** CTE (`WITH monthly_totals AS (...)`) aggregating `view_restaurant_monthly_revenue` across `Asia/Kolkata` calendar months.

---

## Setup & Running Locally (Fresh Clone)

### Prerequisites
- **PostgreSQL 16+** (tested on **PostgreSQL 18**) with `psql` on `PATH`
- **Node.js 20+** and `npm`

### 1. Clone the repository
```bash
git clone https://github.com/vashista22/dbms-project.git
cd dbms-project
```

### 2. Create database, schema, and seed data
```bash
psql -U postgres -c "CREATE DATABASE swiggy;"
psql -U postgres -d swiggy -v ON_ERROR_STOP=1 -f schema.sql -f db/seed_full.sql
```
*(Optional check: the 12 base tables contain `1,151` total rows after loading `db/seed_full.sql`.)*

### 3. Configure environment variables
Copy `.env.example` to `.env` and fill in your PostgreSQL password:
```env
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/swiggy
```

### 4. Install dependencies and run the app
```bash
npm install
npm run build
npm run start
```
Open `http://localhost:3000` (or `npm run dev` for development mode).
- `/` — Customer Portal
- `/owner` — Restaurant Owner Dashboard
- `/partner` — Delivery Partner Portal
- `/admin` — Admin Dashboard & Live Constraint Tester

### 5. Run automated verification scripts
With the Next.js server running (defaults to `http://localhost:3000`, override with `API_BASE_URL`):
```bash
npm run verify:reports
npm run test:double-assignment
```
