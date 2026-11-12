-- ============================================================
-- DBMS Course Project: Food Delivery System
-- Schema Definition: schema.sql
-- ============================================================

-- Clean up existing objects
DROP VIEW IF EXISTS view_top_dishes;
DROP VIEW IF EXISTS view_restaurant_sales;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS coupons CASCADE;
DROP TABLE IF EXISTS delivery_partners CASCADE;
DROP TABLE IF EXISTS menu_items CASCADE;
DROP TABLE IF EXISTS restaurant_cuisines CASCADE;
DROP TABLE IF EXISTS cuisines CASCADE;
DROP TABLE IF EXISTS restaurants CASCADE;
DROP TABLE IF EXISTS addresses CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================
-- 1. TABLES & BASE CONSTRAINTS
-- ============================================================
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('customer', 'owner', 'partner', 'admin')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE addresses (
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    address_no INT NOT NULL,
    label VARCHAR(50),
    line TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    pincode VARCHAR(20) NOT NULL,
    PRIMARY KEY (user_id, address_no)
);

CREATE TABLE restaurants (
    restaurant_id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    is_open BOOLEAN DEFAULT false,
    avg_rating NUMERIC(3, 2) CHECK (avg_rating >= 1.0 AND avg_rating <= 5.0)
);

CREATE TABLE cuisines (
    cuisine_id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE restaurant_cuisines (
    restaurant_id INT NOT NULL REFERENCES restaurants(restaurant_id) ON DELETE CASCADE,
    cuisine_id INT NOT NULL REFERENCES cuisines(cuisine_id) ON DELETE CASCADE,
    PRIMARY KEY (restaurant_id, cuisine_id)
);

CREATE TABLE menu_items (
    item_id SERIAL PRIMARY KEY,
    restaurant_id INT NOT NULL REFERENCES restaurants(restaurant_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    is_veg BOOLEAN NOT NULL,
    is_available BOOLEAN DEFAULT true
);

CREATE TABLE delivery_partners (
    partner_id INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    vehicle_no VARCHAR(50) UNIQUE NOT NULL,
    city VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'offline' CHECK (status IN ('offline', 'available', 'busy'))
);

CREATE TABLE coupons (
    code VARCHAR(50) PRIMARY KEY,
    discount_pct INT NOT NULL CHECK (discount_pct >= 1 AND discount_pct <= 100),
    max_discount NUMERIC(10, 2) CHECK (max_discount >= 0),
    min_order NUMERIC(10, 2) DEFAULT 0 CHECK (min_order >= 0),
    valid_from DATE NOT NULL,
    valid_to DATE NOT NULL,
    CHECK (valid_from <= valid_to)
);

CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL,
    address_no INT NOT NULL,
    restaurant_id INT NOT NULL REFERENCES restaurants(restaurant_id) ON DELETE RESTRICT,
    partner_id INT REFERENCES delivery_partners(partner_id) ON DELETE SET NULL,
    coupon_code VARCHAR(50) REFERENCES coupons(code) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('placed', 'accepted', 'preparing', 'picked_up', 'delivered', 'cancelled')),
    subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
    delivery_fee NUMERIC(10, 2) NOT NULL CHECK (delivery_fee >= 0),
    discount NUMERIC(10, 2) DEFAULT 0 CHECK (discount >= 0),
    total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
    placed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMPTZ,
    FOREIGN KEY (customer_id, address_no) REFERENCES addresses(user_id, address_no) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX one_active_order_per_partner 
ON orders (partner_id) 
WHERE partner_id IS NOT NULL AND status IN ('accepted', 'preparing', 'picked_up');

CREATE TABLE order_items (
    order_id INT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    item_id INT NOT NULL REFERENCES menu_items(item_id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (order_id, item_id)
);

CREATE TABLE payments (
    payment_id SERIAL PRIMARY KEY,
    order_id INT UNIQUE NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    method VARCHAR(50) NOT NULL CHECK (method IN ('upi', 'card', 'cod')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('initiated', 'completed', 'failed', 'refunded')),
    paid_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reviews (
    order_id INT PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
    food_rating INT NOT NULL CHECK (food_rating >= 1 AND food_rating <= 5),
    delivery_rating INT NOT NULL CHECK (delivery_rating >= 1 AND delivery_rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. REPORTING VIEWS
-- ============================================================
CREATE VIEW view_restaurant_sales AS
SELECT 
    r.restaurant_id, 
    r.name AS restaurant_name, 
    COUNT(o.order_id) AS total_orders, 
    COALESCE(SUM(o.total), 0) AS total_revenue
FROM restaurants r
LEFT JOIN orders o ON r.restaurant_id = o.restaurant_id AND o.status = 'delivered'
GROUP BY r.restaurant_id, r.name;

CREATE VIEW view_top_dishes AS
SELECT 
    m.restaurant_id, 
    r.name AS restaurant_name, 
    m.item_id, 
    m.name AS dish_name, 
    SUM(oi.quantity) AS total_sold
FROM menu_items m
JOIN restaurants r ON m.restaurant_id = r.restaurant_id
JOIN order_items oi ON m.item_id = oi.item_id
JOIN orders o ON oi.order_id = o.order_id
WHERE o.status = 'delivered'
GROUP BY m.restaurant_id, r.name, m.item_id, m.name;

-- ============================================================
-- 3. SEARCH & DASHBOARD INDEXES
-- ============================================================
CREATE INDEX idx_restaurants_city ON restaurants(city);
CREATE INDEX idx_cuisines_name ON cuisines(name);
CREATE INDEX idx_menu_items_is_veg ON menu_items(is_veg);
CREATE INDEX idx_menu_items_price ON menu_items(price);
CREATE INDEX idx_orders_status ON orders(status);

-- ============================================================
-- 4. ADVANCED TRIGGERS & BUSINESS RULES
-- ============================================================

-- Role Consistency: Owner
CREATE OR REPLACE FUNCTION enforce_restaurant_owner_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'Restaurant owner_id must reference a user with the owner role';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_owner_role BEFORE INSERT OR UPDATE OF owner_id ON restaurants 
FOR EACH ROW EXECUTE FUNCTION enforce_restaurant_owner_role();

-- Role Consistency: Partner
CREATE OR REPLACE FUNCTION enforce_delivery_partner_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.partner_id AND role = 'partner') THEN
    RAISE EXCEPTION 'partner_id must reference a user with the partner role';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_partner_role BEFORE INSERT ON delivery_partners 
FOR EACH ROW EXECUTE FUNCTION enforce_delivery_partner_role();

-- Avg Rating Sync
CREATE OR REPLACE FUNCTION sync_restaurant_avg_rating() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_rest_id INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT restaurant_id INTO target_rest_id FROM orders WHERE order_id = OLD.order_id;
  ELSE
    SELECT restaurant_id INTO target_rest_id FROM orders WHERE order_id = NEW.order_id;
  END IF;

  UPDATE restaurants
  SET avg_rating = (
    SELECT ROUND(AVG(r.food_rating)::numeric, 2)
    FROM reviews r JOIN orders o ON r.order_id = o.order_id
    WHERE o.restaurant_id = target_rest_id
  )
  WHERE restaurant_id = target_rest_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER trigger_sync_rating AFTER INSERT OR UPDATE OR DELETE ON reviews 
FOR EACH ROW EXECUTE FUNCTION sync_restaurant_avg_rating();

-- Deferred "At Least One Item" Check
CREATE OR REPLACE FUNCTION enforce_order_not_empty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = NEW.order_id) THEN
    RAISE EXCEPTION 'An order must contain at least one item.';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER trigger_order_not_empty 
AFTER INSERT ON orders DEFERRABLE INITIALLY DEFERRED 
FOR EACH ROW EXECUTE FUNCTION enforce_order_not_empty();

-- [Mid-Sem Triggers Retained Below]
CREATE OR REPLACE FUNCTION enforce_order_item_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_restaurant integer; item_restaurant integer; available boolean;
BEGIN
  SELECT restaurant_id INTO order_restaurant FROM orders WHERE order_id=NEW.order_id;
  SELECT restaurant_id,is_available INTO item_restaurant,available FROM menu_items WHERE item_id=NEW.item_id;
  IF order_restaurant IS NULL OR item_restaurant IS DISTINCT FROM order_restaurant THEN
    RAISE EXCEPTION 'Order items must come from the order restaurant';
  END IF;
  IF available IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Menu item is unavailable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_item_business_rules BEFORE INSERT OR UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION enforce_order_item_rules();

CREATE OR REPLACE FUNCTION prevent_order_restaurant_mismatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM order_items oi JOIN menu_items m USING (item_id)
             WHERE oi.order_id=OLD.order_id AND m.restaurant_id IS DISTINCT FROM NEW.restaurant_id) THEN
    RAISE EXCEPTION 'An order restaurant cannot change while its items belong to another restaurant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_restaurant_scope BEFORE UPDATE OF restaurant_id ON orders FOR EACH ROW EXECUTE FUNCTION prevent_order_restaurant_mismatch();

CREATE OR REPLACE FUNCTION prevent_menu_restaurant_mismatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id AND EXISTS (
    SELECT 1 FROM order_items oi JOIN orders o USING (order_id)
    WHERE oi.item_id=OLD.item_id AND o.restaurant_id IS DISTINCT FROM NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'A menu item restaurant cannot change while referenced by orders from another restaurant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER menu_item_restaurant_scope BEFORE UPDATE OF restaurant_id ON menu_items FOR EACH ROW EXECUTE FUNCTION prevent_menu_restaurant_mismatch();

CREATE OR REPLACE FUNCTION enforce_order_status_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'placed' THEN RAISE EXCEPTION 'New orders must start in placed status'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status=OLD.status THEN RETURN NEW; END IF;
  IF NOT ((OLD.status='placed' AND NEW.status IN ('accepted','cancelled')) OR
          (OLD.status='accepted' AND NEW.status IN ('preparing','cancelled')) OR
          (OLD.status='preparing' AND NEW.status IN ('picked_up','cancelled')) OR
          (OLD.status='picked_up' AND NEW.status='delivered')) THEN
    RAISE EXCEPTION 'Invalid order status transition: % -> %',OLD.status,NEW.status;
  END IF;
  IF OLD.status='placed' AND NEW.status='accepted' AND NEW.partner_id IS NULL THEN
    RAISE EXCEPTION 'A delivery partner must be assigned before an order is accepted';
  END IF;
  IF NEW.status='delivered' THEN NEW.delivered_at=COALESCE(NEW.delivered_at,CURRENT_TIMESTAMP); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_status_transition BEFORE INSERT OR UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION enforce_order_status_transition();

CREATE OR REPLACE FUNCTION enforce_review_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE order_id=NEW.order_id AND status='delivered') THEN
    RAISE EXCEPTION 'Only delivered orders can be reviewed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER review_only_after_delivery BEFORE INSERT OR UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION enforce_review_eligibility();
