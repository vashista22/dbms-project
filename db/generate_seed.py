#!/usr/bin/env python3
"""
generate_seed.py - builds db/seed_full.sql for the Swiggy-style food delivery DB.

Usage
-----
    python3 db/generate_seed.py            # writes db/seed_full.sql
    python3 db/generate_seed.py --reset    # same, but the SQL first empties all tables
    psql "$DATABASE_URL" -f db/seed_full.sql

No third-party packages are needed (plain Python 3.8+). The output is deterministic
(fixed random seed), so every team member gets exactly the same data.

How it respects the schema's triggers
-------------------------------------
* Orders are inserted as 'placed', and their items are added while still 'placed'
  (trigger order_item_business_rules: item must belong to the order's restaurant
  and be available).
* A partner is assigned BEFORE the status moves to 'accepted' (order_status_transition),
  and every order then walks the legal path
  placed -> accepted -> preparing -> picked_up -> delivered (or -> cancelled before pickup).
* Orders still in progress are processed LAST, and each holds a different partner, so the
  partial unique index one_active_order_per_partner is never violated.
* Reviews are inserted only after their order is 'delivered' (review_only_after_delivery).
* Everything runs in one transaction, so any deferred "order has >= 1 item" constraint
  trigger is checked at COMMIT, after the items exist.

Assumptions about the schema (edit the constants below if your schema.sql differs)
----------------------------------------------------------------------------------
* column names exactly as in the Section 6 table of the design document;
* enum-like values: see the CONSTANTS block;
* restaurants.avg_rating = mean of reviews.food_rating (delivery_rating describes the
  rider, not the restaurant). This matches the sync trigger in the final schema.sql.
* Every order has exactly one payment (as the place-order workflow creates it): completed (UPI/card),
  initiated (COD), refunded (cancelled prepaid) or failed (cancelled COD).
"""
import argparse
import random
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

# --------------------------------------------------------------------------- CONSTANTS
SEED = 2026
OUT_DEFAULT = "db/seed_full.sql"

ROLE_CUSTOMER, ROLE_OWNER, ROLE_PARTNER, ROLE_ADMIN = "customer", "owner", "partner", "admin"
PARTNER_FREE, PARTNER_BUSY = "available", "busy"
PAY_PREPAID = ["upi", "card"]          # marked completed
PAY_COD = "cod"                        # stays initiated
PAY_DONE, PAY_INIT = "completed", "initiated"
PAY_REFUND, PAY_FAIL = "refunded", "failed"   # cancelled orders: prepaid -> refunded, COD -> failed
DELIVERY_FEE = Decimal("49.00")

N_OWNERS, N_PARTNERS = 5, 10
CUSTOMERS_PER_CITY = {"Hyderabad": 14, "Bengaluru": 11, "Mumbai": 9}   # 34 customers
PARTNERS_PER_CITY = {"Hyderabad": 4, "Bengaluru": 3, "Mumbai": 3}      # 10 partners

# Order mix (sums to 160). The last five are "in progress" at the demo date.
ORDER_PLAN = (["delivered"] * 135 + ["cancelled_placed"] * 8 + ["cancelled_accepted"] * 4
              + ["placed"] * 5 + ["accepted"] * 3 + ["preparing"] * 3 + ["picked_up"] * 2)
ACTIVE = {"accepted", "preparing", "picked_up"}      # states that block a partner
IN_PROGRESS_PLANS = ["placed", "accepted", "preparing", "picked_up"]
REVIEW_PROBABILITY = 0.70

START, END = date(2026, 9, 1), date(2026, 11, 8)     # placed_at range of finished orders
PRICE_CHANGE = datetime(2026, 10, 1)                 # menu price hike date (shows rule R3)

# After the status walk, delivered_at is back-dated to placed_at + 30..60 minutes
# (the trigger stamps delivered_at with now()). Needs permission to disable one trigger.
BACKDATE_DELIVERY = True
STATUS_TRIGGER = "order_status_transition"

# --------------------------------------------------------------------------- STATIC DATA
CITIES = {
    "Hyderabad": ("TS", ["Gachibowli", "Madhapur", "Banjara Hills", "Kondapur", "Jubilee Hills", "Begumpet"]),
    "Bengaluru": ("KA", ["Koramangala", "Indiranagar", "HSR Layout", "Whitefield", "Jayanagar", "Marathahalli"]),
    "Mumbai": ("MH", ["Bandra", "Andheri", "Powai", "Dadar", "Colaba", "Juhu"]),
}
PIN_PREFIX = {"Hyderabad": "5000", "Bengaluru": "5600", "Mumbai": "4000"}

FIRST = ["Aarav", "Vivaan", "Aditya", "Arjun", "Rohan", "Karthik", "Siddharth", "Rahul", "Nikhil", "Varun",
         "Ananya", "Diya", "Priya", "Sneha", "Kavya", "Meera", "Ishita", "Neha", "Pooja", "Riya",
         "Tarun", "Harsha", "Manish", "Sanjay", "Vikram", "Deepak", "Lakshmi", "Divya", "Swathi", "Anjali",
         "Rajesh", "Suresh", "Mohan", "Naveen", "Pranav", "Shreya", "Tanvi", "Bhavya", "Kiran", "Sameer"]
LAST = ["Sharma", "Reddy", "Nair", "Iyer", "Patel", "Gupta", "Rao", "Menon", "Joshi", "Verma",
        "Kulkarni", "Naidu", "Singh", "Das", "Pillai", "Mehta", "Desai", "Chowdhury", "Bhat", "Khan"]

CUISINES = ["North Indian", "South Indian", "Biryani", "Chinese", "Italian", "Fast Food", "Desserts", "Healthy"]

# (dish, base price in INR, is_veg)
DISHES = {
    "North Indian": [("Paneer Butter Masala", 240, 1), ("Dal Makhani", 200, 1), ("Butter Chicken", 310, 0),
                     ("Chicken Tikka", 280, 0), ("Garlic Naan", 55, 1), ("Veg Kolhapuri", 220, 1),
                     ("Mutton Rogan Josh", 380, 0), ("Jeera Rice", 140, 1)],
    "South Indian": [("Masala Dosa", 110, 1), ("Idli Sambar", 80, 1), ("Ghee Pongal", 100, 1),
                     ("Rava Dosa", 120, 1), ("Onion Uttapam", 115, 1), ("Curd Rice", 90, 1),
                     ("Chicken Chettinad", 290, 0), ("Egg Dosa", 130, 0)],
    "Biryani": [("Chicken Dum Biryani", 280, 0), ("Mutton Biryani", 360, 0), ("Veg Biryani", 220, 1),
                ("Egg Biryani", 220, 0), ("Paneer Biryani", 250, 1), ("Mirchi Ka Salan", 90, 1),
                ("Boondi Raita", 50, 1), ("Chicken 65", 220, 0)],
    "Chinese": [("Veg Hakka Noodles", 160, 1), ("Chicken Fried Rice", 190, 0), ("Gobi Manchurian", 170, 1),
                ("Chilli Chicken", 230, 0), ("Veg Manchow Soup", 120, 1), ("Schezwan Noodles", 180, 1),
                ("Paneer Chilli", 210, 1), ("Veg Spring Rolls", 140, 1)],
    "Italian": [("Margherita Pizza", 249, 1), ("Farmhouse Pizza", 329, 1), ("Pepperoni Pizza", 379, 0),
                ("Penne Arrabbiata", 260, 1), ("Chicken Alfredo Pasta", 310, 0), ("Garlic Bread", 120, 1),
                ("Baked Lasagna", 340, 0), ("Tiramisu", 180, 1)],
    "Fast Food": [("Veg Burger", 99, 1), ("Chicken Burger", 149, 0), ("French Fries", 89, 1),
                  ("Chicken Wrap", 139, 0), ("Paneer Wrap", 129, 1), ("Chicken Nuggets", 149, 0),
                  ("Cold Coffee", 99, 1), ("Peri Peri Fries", 119, 1)],
    "Desserts": [("Gulab Jamun", 80, 1), ("Chocolate Brownie", 120, 1), ("Rasmalai", 110, 1),
                 ("Ice Cream Sundae", 150, 1), ("Red Velvet Pastry", 130, 1), ("Kaju Katli Box", 200, 1),
                 ("Falooda", 140, 1), ("Blueberry Cheesecake", 190, 1)],
    "Healthy": [("Quinoa Salad Bowl", 220, 1), ("Grilled Chicken Salad", 260, 0), ("Greek Salad", 210, 1),
                ("Fresh Fruit Bowl", 150, 1), ("Protein Smoothie", 180, 1), ("Oats Bowl", 130, 1),
                ("Grilled Fish Plate", 340, 0), ("Sprouts Chaat", 110, 1)],
}

RESTAURANTS = [  # (name, city, cuisines)
    ("Spice Route", "Hyderabad", ["North Indian", "Chinese"]),
    ("Tiffin Tales", "Hyderabad", ["South Indian", "Desserts"]),
    ("Nizam's Kitchen", "Hyderabad", ["Biryani", "North Indian"]),
    ("Pizza Pilgrim", "Hyderabad", ["Italian", "Fast Food"]),
    ("Green Plate", "Hyderabad", ["Healthy", "South Indian"]),
    ("Royal Tandoor", "Hyderabad", ["North Indian", "Biryani", "Desserts"]),
    ("Dosa Junction", "Bengaluru", ["South Indian", "Fast Food"]),
    ("Wok This Way", "Bengaluru", ["Chinese", "Healthy"]),
    ("La Piazza", "Bengaluru", ["Italian", "Desserts"]),
    ("Biryani Bazaar", "Bengaluru", ["Biryani", "Chinese"]),
    ("The Curry Leaf", "Bengaluru", ["North Indian", "South Indian"]),
    ("Burger Barn", "Mumbai", ["Fast Food", "Italian"]),
    ("Sweet Tooth Studio", "Mumbai", ["Desserts", "Healthy"]),
    ("Noodle Box", "Mumbai", ["Chinese", "Fast Food"]),
    ("Midnight Munchies", "Mumbai", ["Fast Food", "North Indian"]),
]
ITEMS_PER_RESTAURANT = 10

COUPONS = [  # code, pct, max_discount, min_order, valid_from, valid_to
    ("WELCOME50", 50, 100, 199, date(2026, 8, 1), date(2026, 12, 31)),
    ("FLAT20", 20, 60, 149, date(2026, 8, 1), date(2026, 12, 31)),
    ("FEAST30", 30, 150, 499, date(2026, 9, 1), date(2026, 12, 31)),
    ("SEPT15", 15, 50, 99, date(2026, 9, 1), date(2026, 9, 30)),        # expired - good for demo
    ("FESTIVE25", 25, 120, 299, date(2026, 10, 15), date(2026, 11, 30)),
]

COMMENTS = {
    5: ["Fresh and piping hot, loved it!", "Excellent taste and generous portions.", "Best order this month."],
    4: ["Tasty food, delivery was on time.", "Good value for money.", "Really good, would order again."],
    3: ["Decent, but nothing special.", "Food was okay, a bit lukewarm.", "Average experience."],
    2: ["Food arrived cold and portions were small.", "Not as described on the menu."],
    1: ["Very disappointed, wrong items delivered.", "Food was stale. Will not order again."],
}
STREETS = ["MG Road", "Park Street", "Lake View Road", "Temple Lane", "Station Road", "Palm Avenue", "Hill Crest Road"]


# --------------------------------------------------------------------------- HELPERS
def q(v):
    """Render a Python value as a SQL literal."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, Decimal):
        return f"{v:.2f}"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, datetime):
        return "'" + v.strftime("%Y-%m-%d %H:%M:%S") + "'"
    if isinstance(v, date):
        return "'" + v.isoformat() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def insert(table, cols, rows):
    body = ",\n".join("  (" + ", ".join(q(v) for v in r) + ")" for r in rows)
    return f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n{body};"


def r5(x):
    return int(round(x / 5.0)) * 5


def money(x):
    return Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------- GENERATION
def build(rng):
    users, addresses = [], []          # users: dict rows
    used_phones, used_emails = set(), set()

    def new_user(name, role, created):
        uid = len(users) + 1
        while True:
            phone = "9" + f"{rng.randint(0, 99999999):08d}"
            if phone not in used_phones:
                used_phones.add(phone)
                break
        email = name.lower().replace(" ", ".") + str(uid) + "@example.com"
        assert email not in used_emails
        used_emails.add(email)
        users.append(dict(user_id=uid, name=name, email=email, phone=phone, role=role, created_at=created))
        return uid

    def created():
        return datetime(2026, 8, 1) + timedelta(days=rng.randint(0, 25), hours=rng.randint(8, 20),
                                                  minutes=rng.randint(0, 59))

    def person(i):
        return f"{FIRST[i % len(FIRST)]} {LAST[(i * 7 + 3) % len(LAST)]}"

    new_user("Platform Admin", ROLE_ADMIN, datetime(2026, 8, 1, 9, 0, 0))
    owner_ids = [new_user(person(i), ROLE_OWNER, created()) for i in range(N_OWNERS)]

    # delivery partners (users with role partner + subclass row)
    partners, vehicles, pi = [], set(), N_OWNERS
    for city, n in PARTNERS_PER_CITY.items():
        state = CITIES[city][0]
        for _ in range(n):
            uid = new_user(person(pi + 11), ROLE_PARTNER, created())
            pi += 1
            while True:
                veh = f"{state}{rng.randint(1, 40):02d}{rng.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}" \
                      f"{rng.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{rng.randint(1000, 9999)}"
                if veh not in vehicles:
                    vehicles.add(veh)
                    break
            partners.append(dict(partner_id=uid, vehicle_no=veh, city=city, status=PARTNER_FREE))

    # customers + addresses
    customers, ci = [], 0
    for city, n in CUSTOMERS_PER_CITY.items():
        areas = CITIES[city][1]
        for _ in range(n):
            uid = new_user(person(ci + 20), ROLE_CUSTOMER, created())
            ci += 1
            labels = ["Home", "Work", "Other"][: rng.choice([1, 2, 2, 3])]
            nos = []
            for no, label in enumerate(labels, start=1):
                line = f"Flat {rng.randint(101, 960)}, {rng.randint(1, 80)} {rng.choice(STREETS)}, {rng.choice(areas)}"
                pin = PIN_PREFIX[city] + f"{rng.randint(1, 99):02d}"
                addresses.append(dict(user_id=uid, address_no=no, label=label, line=line, city=city, pincode=pin))
                nos.append(no)
            customers.append(dict(user_id=uid, city=city, address_nos=nos))

    # cuisines, restaurants, menu items
    cuisine_id = {name: i for i, name in enumerate(CUISINES, start=1)}
    restaurants, rest_cuisines, items = [], [], []
    for i, (name, city, cuis) in enumerate(RESTAURANTS, start=1):
        areas = CITIES[city][1]
        restaurants.append(dict(restaurant_id=i, owner_id=owner_ids[(i - 1) % N_OWNERS], name=name, city=city,
                                address=f"{rng.randint(1, 150)}, {rng.choice(areas)} Main Road, {city}",
                                is_open=True, avg_rating=None, cuisines=cuis))
        rest_cuisines += [(i, cuisine_id[c]) for c in cuis]
        pool = {}
        for c in cuis:
            for dn, base, veg in DISHES[c]:
                pool.setdefault(dn, (base, veg))
        for dn in rng.sample(sorted(pool), ITEMS_PER_RESTAURANT):
            base, veg = pool[dn]
            items.append(dict(item_id=len(items) + 1, restaurant_id=i, name=dn, price=Decimal(r5(base * rng.uniform(0.9, 1.12))),
                              is_veg=bool(veg), is_available=True, old_price=None))
    # a price hike on 22 dishes on PRICE_CHANGE: older orders keep the old price (rule R3)
    for it in rng.sample(items, 22):
        it["old_price"] = it["price"] - Decimal(rng.choice([5, 10, 15]))
    items_by_rest = defaultdict(list)
    for it in items:
        items_by_rest[it["restaurant_id"]].append(it)
    rest_by_id = {r["restaurant_id"]: r for r in restaurants}
    partners_by_city = defaultdict(list)
    for p in partners:
        partners_by_city[p["city"]].append(p["partner_id"])
    customers_by_city = defaultdict(list)
    for c in customers:
        customers_by_city[c["city"]].append(c)

    # ---- orders (built unsorted, then given ids in chronological order)
    def rand_placed():
        d = START + timedelta(days=rng.randint(0, (END - START).days))
        return datetime(d.year, d.month, d.day, rng.choice([11, 12, 13, 13, 14, 18, 19, 20, 20, 21, 22]),
                        rng.randint(0, 59), rng.randint(0, 59))

    plan = ORDER_PLAN[:]
    terminal = [p for p in plan if p not in IN_PROGRESS_PLANS]
    in_progress = [p for p in plan if p in IN_PROGRESS_PLANS]
    rng.shuffle(terminal)
    orders, used_active_partners = [], set()

    def make_order(kind, restaurant, placed_at, partner_id):
        cust = rng.choice(customers_by_city[restaurant["city"]])
        lines = []
        for it in rng.sample(items_by_rest[restaurant["restaurant_id"]], rng.choice([1, 2, 2, 3, 3, 4])):
            price = it["old_price"] if (it["old_price"] and placed_at < PRICE_CHANGE) else it["price"]
            lines.append(dict(item_id=it["item_id"], quantity=rng.choice([1, 1, 1, 2, 2, 3]), unit_price=price))
        subtotal = sum((l["unit_price"] * l["quantity"] for l in lines), Decimal("0"))
        coupon, discount = None, Decimal("0.00")
        if rng.random() < 0.40:
            ok = [c for c in COUPONS if c[4] <= placed_at.date() <= c[5] and subtotal >= c[3]]
            if ok:
                code, pct, cap, _, _, _ = rng.choice(ok)
                coupon, discount = code, min(money(subtotal * pct / 100), Decimal(cap))
        orders.append(dict(kind=kind, customer_id=cust["user_id"], address_no=rng.choice(cust["address_nos"]),
                           restaurant_id=restaurant["restaurant_id"], partner_id=partner_id, coupon_code=coupon,
                           subtotal=money(subtotal), delivery_fee=DELIVERY_FEE, discount=discount,
                           total=money(subtotal + DELIVERY_FEE - discount), placed_at=placed_at, lines=lines))

    for k, kind in enumerate(terminal):
        rest = restaurants[k % len(restaurants)]          # round robin: every restaurant gets orders
        partner = rng.choice(partners_by_city[rest["city"]]) if kind != "cancelled_placed" else None
        make_order(kind, rest, rand_placed(), partner)

    for kind in in_progress:                               # latest orders; distinct partners
        placed = datetime(2026, 11, 10, 18, 0, 0) + timedelta(minutes=rng.randint(0, 900))
        while True:
            rest = rng.choice(restaurants)
            if kind == "placed":
                partner = None
                break
            free = [p for p in partners_by_city[rest["city"]] if p not in used_active_partners]
            if free:
                partner = rng.choice(free)
                used_active_partners.add(partner)
                break
        make_order(kind, rest, placed, partner)

    orders.sort(key=lambda o: (o["placed_at"], o["customer_id"]))
    for i, o in enumerate(orders, start=1):
        o["order_id"] = i

    # ---- payments (not for cancelled orders)
    payments = []
    for o in orders:
        method = rng.choices(PAY_PREPAID + [PAY_COD], weights=[55, 25, 20])[0]
        done = method != PAY_COD
        cancelled = o["kind"].startswith("cancelled")
        if cancelled:
            status = PAY_REFUND if done else PAY_FAIL      # money returned / COD never collected
        else:
            status = PAY_DONE if done else PAY_INIT        # COD stays initiated until the app settles it
        payments.append(dict(payment_id=len(payments) + 1, order_id=o["order_id"], amount=o["total"], method=method,
                             status=status,
                             paid_at=(o["placed_at"] + timedelta(minutes=rng.randint(1, 3))) if done else None))

    # ---- reviews (delivered orders only)
    reviews = []
    for o in orders:
        if o["kind"] == "delivered" and rng.random() < REVIEW_PROBABILITY:
            food = rng.choices([1, 2, 3, 4, 5], weights=[3, 7, 15, 40, 35])[0]
            deliv = rng.choices([1, 2, 3, 4, 5], weights=[3, 7, 15, 40, 35])[0]
            reviews.append(dict(order_id=o["order_id"], food_rating=food, delivery_rating=deliv,
                                comment=rng.choice(COMMENTS[food]),
                                created_at=o["placed_at"] + timedelta(minutes=rng.randint(60, 120))))
    ratings = defaultdict(list)
    order_rest = {o["order_id"]: o["restaurant_id"] for o in orders}
    for rv in reviews:
        ratings[order_rest[rv["order_id"]]].append(rv["food_rating"])
    for r in restaurants:
        assert ratings[r["restaurant_id"]], f"restaurant {r['name']} has no reviews - raise REVIEW_PROBABILITY"
        r["avg_rating"] = Decimal(str(round(sum(ratings[r["restaurant_id"]]) / len(ratings[r["restaurant_id"]]), 1)))

    # ---- end-of-seed state tweaks
    unavailable = [it["item_id"] for it in rng.sample(items, 8)]
    busy = sorted({o["partner_id"] for o in orders if o["kind"] in ACTIVE})
    active_rests = {o["restaurant_id"] for o in orders if o["kind"] in ACTIVE or o["kind"] == "placed"}
    closed = [r["restaurant_id"] for r in restaurants if r["restaurant_id"] not in active_rests][-1]

    return dict(users=users, addresses=addresses, cuisine_id=cuisine_id, restaurants=restaurants,
                rest_cuisines=rest_cuisines, items=items, partners=partners, orders=orders, payments=payments,
                reviews=reviews, unavailable=unavailable, busy=busy, closed=closed, rest_by_id=rest_by_id)


def check(d):
    """Sanity checks on the generated data (mirrors the business rules R1-R7)."""
    item_rest = {i["item_id"]: i["restaurant_id"] for i in d["items"]}
    part_city = {p["partner_id"]: p["city"] for p in d["partners"]}
    addr = {(a["user_id"], a["address_no"]) for a in d["addresses"]}
    coupons = {c[0]: c for c in COUPONS}
    active_partners = []
    for o in d["orders"]:
        assert (o["customer_id"], o["address_no"]) in addr                                        # R1
        assert all(item_rest[l["item_id"]] == o["restaurant_id"] for l in o["lines"])             # R2
        assert o["total"] == o["subtotal"] + o["delivery_fee"] - o["discount"]
        if o["coupon_code"]:                                                                      # R4
            c = coupons[o["coupon_code"]]
            assert c[4] <= o["placed_at"].date() <= c[5] and o["subtotal"] >= c[3] and o["discount"] <= c[2]
        if o["partner_id"]:                                                                       # same city
            assert part_city[o["partner_id"]] == d["rest_by_id"][o["restaurant_id"]]["city"]
        if o["kind"] in ACTIVE:                                                                   # R5
            active_partners.append(o["partner_id"])
    assert len(active_partners) == len(set(active_partners))


# --------------------------------------------------------------------------- SQL OUTPUT
PATHS = {
    "delivered": ["accepted", "preparing", "picked_up", "delivered"],
    "cancelled_placed": ["cancelled"],
    "cancelled_accepted": ["accepted", "cancelled"],
    "placed": [],
    "accepted": ["accepted"],
    "preparing": ["accepted", "preparing"],
    "picked_up": ["accepted", "preparing", "picked_up"],
}


def render(d, reset):
    o = []
    out = o.append
    n = {k: len(d[k]) for k in ("users", "addresses", "restaurants", "items", "partners", "orders", "payments", "reviews")}
    n["order_items"] = sum(len(x["lines"]) for x in d["orders"])
    total_rows = sum(n.values()) + len(CUISINES) + len(d["rest_cuisines"]) + len(COUPONS)
    out("-- Generated by db/generate_seed.py (deterministic, seed=%d). Do not edit by hand; re-run the script." % SEED)
    out("-- Rows: " + ", ".join(f"{k}={v}" for k, v in n.items()) +
        f", cuisines={len(CUISINES)}, restaurant_cuisines={len(d['rest_cuisines'])}, coupons={len(COUPONS)}"
        f"  (total {total_rows})")
    out("BEGIN;")
    if reset:
        out("TRUNCATE reviews, payments, order_items, orders, menu_items, restaurant_cuisines, restaurants,\n"
            "         cuisines, delivery_partners, addresses, coupons, users RESTART IDENTITY CASCADE;")
    out("")
    out(insert("users", ["user_id", "name", "email", "phone", "role", "created_at"],
               [(u["user_id"], u["name"], u["email"], u["phone"], u["role"], u["created_at"]) for u in d["users"]]))
    out(insert("addresses", ["user_id", "address_no", "label", "line", "city", "pincode"],
               [(a["user_id"], a["address_no"], a["label"], a["line"], a["city"], a["pincode"]) for a in d["addresses"]]))
    out(insert("cuisines", ["cuisine_id", "name"], [(i, n_) for n_, i in d["cuisine_id"].items()]))
    out(insert("restaurants", ["restaurant_id", "owner_id", "name", "city", "address", "is_open", "avg_rating"],
               [(r["restaurant_id"], r["owner_id"], r["name"], r["city"], r["address"], r["is_open"], r["avg_rating"])
                for r in d["restaurants"]]))
    out(insert("restaurant_cuisines", ["restaurant_id", "cuisine_id"], d["rest_cuisines"]))
    out(insert("menu_items", ["item_id", "restaurant_id", "name", "price", "is_veg", "is_available"],
               [(i["item_id"], i["restaurant_id"], i["name"], i["price"], i["is_veg"], i["is_available"]) for i in d["items"]]))
    out(insert("delivery_partners", ["partner_id", "vehicle_no", "city", "status"],
               [(p["partner_id"], p["vehicle_no"], p["city"], p["status"]) for p in d["partners"]]))
    out(insert("coupons", ["code", "discount_pct", "max_discount", "min_order", "valid_from", "valid_to"],
               [(c[0], c[1], Decimal(c[2]), Decimal(c[3]), c[4], c[5]) for c in COUPONS]))

    out("\n-- Orders start as 'placed' (trigger order_status_transition); items are added while still placed.")
    out(insert("orders", ["order_id", "customer_id", "address_no", "restaurant_id", "coupon_code", "status",
                          "subtotal", "delivery_fee", "discount", "total", "placed_at"],
               [(x["order_id"], x["customer_id"], x["address_no"], x["restaurant_id"], x["coupon_code"], "placed",
                 x["subtotal"], x["delivery_fee"], x["discount"], x["total"], x["placed_at"]) for x in d["orders"]]))
    out(insert("order_items", ["order_id", "item_id", "quantity", "unit_price"],
               [(x["order_id"], l["item_id"], l["quantity"], l["unit_price"]) for x in d["orders"] for l in x["lines"]]))
    out(insert("payments", ["payment_id", "order_id", "amount", "method", "status", "paid_at"],
               [(p["payment_id"], p["order_id"], p["amount"], p["method"], p["status"], p["paid_at"]) for p in d["payments"]]))

    out("\n-- Walk every order through its legal status path. Finished orders first, in-progress orders last,")
    out("-- so the partial unique index (one active order per partner) is never violated.")
    for group in (lambda x: x["kind"] not in ACTIVE and x["kind"] != "placed", lambda x: x["kind"] in ACTIVE or x["kind"] == "placed"):
        for x in filter(group, d["orders"]):
            if x["partner_id"]:
                out(f"UPDATE orders SET partner_id = {x['partner_id']} WHERE order_id = {x['order_id']};")
            for st in PATHS[x["kind"]]:
                out(f"UPDATE orders SET status = '{st}' WHERE order_id = {x['order_id']};")

    out("\n-- Reviews: only for delivered orders (trigger review_only_after_delivery).")
    out(insert("reviews", ["order_id", "food_rating", "delivery_rating", "comment", "created_at"],
               [(r["order_id"], r["food_rating"], r["delivery_rating"], r["comment"], r["created_at"]) for r in d["reviews"]]))

    out("\n-- End state: a few unavailable dishes, one closed restaurant, partners with live orders are busy.")
    out("UPDATE menu_items SET is_available = FALSE WHERE item_id IN (%s);" % ", ".join(map(str, d["unavailable"])))
    out(f"UPDATE restaurants SET is_open = FALSE WHERE restaurant_id = {d['closed']};")
    if d["busy"]:
        out(f"UPDATE delivery_partners SET status = '{PARTNER_BUSY}' WHERE partner_id IN ({', '.join(map(str, d['busy']))});")

    if BACKDATE_DELIVERY:
        out("\n-- The trigger stamps delivered_at = now(); back-date it so dashboards show realistic history.")
        out("SET CONSTRAINTS ALL IMMEDIATE;   -- run deferred checks now (ALTER TABLE is blocked while they are pending)")
        out(f"ALTER TABLE orders DISABLE TRIGGER {STATUS_TRIGGER};")
        out("UPDATE orders SET delivered_at = placed_at + (30 + (order_id * 7) % 31) * INTERVAL '1 minute'\n"
            " WHERE status = 'delivered';")
        out(f"ALTER TABLE orders ENABLE TRIGGER {STATUS_TRIGGER};")

    out("\n-- Keep SERIAL sequences ahead of the explicit ids used above.")
    for t, c in [("users", "user_id"), ("restaurants", "restaurant_id"), ("menu_items", "item_id"),
                 ("orders", "order_id"), ("payments", "payment_id"), ("cuisines", "cuisine_id")]:
        out(f"SELECT setval(pg_get_serial_sequence('{t}', '{c}'), (SELECT MAX({c}) FROM {t}));")
    out("\nCOMMIT;")
    return "\n".join(o) + "\n", n, total_rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--out", default=OUT_DEFAULT, help="output file (default: %(default)s)")
    ap.add_argument("--reset", action="store_true", help="TRUNCATE all tables at the start of the script")
    args = ap.parse_args()

    data = build(random.Random(SEED))
    check(data)
    sql, counts, total = render(data, args.reset)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(sql)
    status = Counter(x["kind"] for x in data["orders"])
    print(f"Wrote {args.out}: {total} rows", file=sys.stderr)
    print("  " + ", ".join(f"{k}={v}" for k, v in counts.items()), file=sys.stderr)
    print("  orders by plan: " + ", ".join(f"{k}={v}" for k, v in sorted(status.items())), file=sys.stderr)


if __name__ == "__main__":
    main()
