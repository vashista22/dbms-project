# Swiggy-Style Food Delivery System (DBMS Course Project)

## Project Description
A simplified, full-stack food delivery platform simulating core Swiggy workflows. The system allows customers to browse restaurants, add dishes to a cart, apply date/value-constrained coupons, and track orders. It supports restaurant owners managing their menus and accepting orders, while delivery partners are dynamically assigned to handle fulfillment. The core database focus is on order integrity, status transitions, partner assignment constraints, and transactional reporting.

**Technology Stack**
*   **Database:** PostgreSQL
*   **Backend/API:** Next.js API Routes (using `pg` driver)
*   **Frontend:** Next.js (App Router, React UI)

## Current Progress (Mid-Sem Submission)
*   Finalized requirements, business rules, and constraints.
*   Completed conceptual database design (ER/EER Diagram).
*   Mapped relational schema (12 tables in 3NF/BCNF).
*   Drafted `schema.sql` including all primary keys, foreign keys, table structures, and integrity constraints (CHECK, UNIQUE, partial indexes).
*   Scaffolded Next.js repository structure.

## Major Workflows
1.  **Place Order:** Validates items/coupons, inserts order and items transactionally (capturing a static price snapshot), processes payment, and confirms order.
2.  **Search & Dashboards:** Retrieves restaurants and dishes filtered by city, cuisine, veg-only, and price. Includes aggregation queries for restaurant sales and top-dish reporting.
3.  **Delivery Assignment:** Moves an order through sequential statuses (`placed → accepted → preparing → picked_up → delivered`) using triggers and partial unique indexes to prevent invalid transitions and double-assignments.

## Setup & Run Instructions
*(To be expanded for final submission)*
1. Clone the repository.
2. Ensure PostgreSQL is installed and running locally.
3. Run `psql -U postgres -d <your_db_name> -f schema.sql` to initialize the database tables.
4. Run `npm install` and `npm run dev` to start the Next.js development server.

## Team Members & Contributions
*   **Vashista Vasantharao [ID: 2023A8PS0439H]**: Developed the SQL DDL scripts (`schema.sql`) including table creation and constraints; authored the project README, and generated the final ER/EER diagrams.
*   **Aayush Rastogi [ID: 2023B2A30888H]**: Gathered requirements, defined business rules/workflows and documented the relational schema mapping, constraints for the design PDF.
*   **Anirudh Peddinti [ID: 2023AAPS0192H]**: Defined technology stack & architecture, set up the GitHub repository, and scaffolded the Next.js + PostgreSQL project.
*   **Sri Niketh Mulagada [ID: 2023B2A80941H]**: Authored the normalization justification, proofread the database logic, and compiled the final Design PDF.