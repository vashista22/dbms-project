-- ============================================================
-- Standalone Trigger & Constraint Refresh Script (db/integrity.sql)
-- Re-applies all 11 business-rule triggers onto an initialized schema.
-- ============================================================

-- 1. Role Consistency: Restaurant Owner
CREATE OR REPLACE FUNCTION enforce_restaurant_owner_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'Restaurant owner_id must reference a user with the owner role';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS check_owner_role ON restaurants;
CREATE TRIGGER check_owner_role BEFORE INSERT OR UPDATE OF owner_id ON restaurants
FOR EACH ROW EXECUTE FUNCTION enforce_restaurant_owner_role();

-- 2. Role Consistency: Delivery Partner
CREATE OR REPLACE FUNCTION enforce_delivery_partner_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.partner_id AND role = 'partner') THEN
    RAISE EXCEPTION 'partner_id must reference a user with the partner role';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS check_partner_role ON delivery_partners;
CREATE TRIGGER check_partner_role BEFORE INSERT OR UPDATE OF partner_id ON delivery_partners
FOR EACH ROW EXECUTE FUNCTION enforce_delivery_partner_role();

-- 3. Role Consistency: Order Customer
CREATE OR REPLACE FUNCTION enforce_order_customer_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.customer_id AND role = 'customer') THEN
    RAISE EXCEPTION 'Order customer_id must reference a user with the customer role';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS check_customer_role ON orders;
CREATE TRIGGER check_customer_role BEFORE INSERT OR UPDATE OF customer_id ON orders
FOR EACH ROW EXECUTE FUNCTION enforce_order_customer_role();

-- 4. Derived Cache Sync: Keep restaurants.avg_rating synced with reviews
CREATE OR REPLACE FUNCTION sync_restaurant_avg_rating() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_rest_id INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT restaurant_id INTO target_rest_id FROM orders WHERE order_id = OLD.order_id;
  ELSE
    SELECT restaurant_id INTO target_rest_id FROM orders WHERE order_id = NEW.order_id;
  END IF;
  IF target_rest_id IS NOT NULL THEN
    UPDATE restaurants
    SET avg_rating = (
      SELECT ROUND(AVG(r.food_rating)::numeric, 2)
      FROM reviews r JOIN orders o ON r.order_id = o.order_id
      WHERE o.restaurant_id = target_rest_id
    )
    WHERE restaurant_id = target_rest_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS trigger_sync_rating ON reviews;
CREATE TRIGGER trigger_sync_rating AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION sync_restaurant_avg_rating();

-- 5. Deferred "At Least One Item" Check on Order Insert
CREATE OR REPLACE FUNCTION enforce_order_not_empty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM orders WHERE order_id = NEW.order_id)
     AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = NEW.order_id) THEN
    RAISE EXCEPTION 'An order must contain at least one item.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trigger_order_not_empty ON orders;
CREATE CONSTRAINT TRIGGER trigger_order_not_empty
AFTER INSERT ON orders DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_order_not_empty();

-- 6. Deferred Companion Check on Order Item Delete/Move
CREATE OR REPLACE FUNCTION enforce_remaining_order_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM orders WHERE order_id = OLD.order_id)
     AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = OLD.order_id) THEN
    RAISE EXCEPTION 'An existing order must retain at least one item.';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trigger_remaining_order_items ON order_items;
CREATE CONSTRAINT TRIGGER trigger_remaining_order_items
AFTER DELETE OR UPDATE OF order_id ON order_items DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_remaining_order_items();

-- 7. Order Item Business Rules
CREATE OR REPLACE FUNCTION enforce_order_item_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_restaurant INT; item_restaurant INT; available BOOLEAN;
BEGIN
  SELECT restaurant_id INTO order_restaurant FROM orders WHERE order_id = NEW.order_id;
  SELECT restaurant_id, is_available INTO item_restaurant, available FROM menu_items WHERE item_id = NEW.item_id;
  IF order_restaurant IS NULL OR item_restaurant IS DISTINCT FROM order_restaurant THEN
    RAISE EXCEPTION 'Order items must come from the order restaurant';
  END IF;
  IF available IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Menu item is unavailable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_item_business_rules ON order_items;
CREATE TRIGGER order_item_business_rules BEFORE INSERT OR UPDATE ON order_items
FOR EACH ROW EXECUTE FUNCTION enforce_order_item_rules();

-- 8. Order Restaurant Scope
CREATE OR REPLACE FUNCTION prevent_order_restaurant_mismatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM order_items oi JOIN menu_items m USING (item_id)
    WHERE oi.order_id = OLD.order_id AND m.restaurant_id IS DISTINCT FROM NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'An order restaurant cannot change while its items belong to another restaurant';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_restaurant_scope ON orders;
CREATE TRIGGER order_restaurant_scope BEFORE UPDATE OF restaurant_id ON orders
FOR EACH ROW EXECUTE FUNCTION prevent_order_restaurant_mismatch();

-- 9. Menu Item Restaurant Scope
CREATE OR REPLACE FUNCTION prevent_menu_restaurant_mismatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id AND EXISTS (
    SELECT 1 FROM order_items oi JOIN orders o USING (order_id)
    WHERE oi.item_id = OLD.item_id AND o.restaurant_id IS DISTINCT FROM NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'A menu item restaurant cannot change while referenced by orders from another restaurant';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS menu_item_restaurant_scope ON menu_items;
CREATE TRIGGER menu_item_restaurant_scope BEFORE UPDATE OF restaurant_id ON menu_items
FOR EACH ROW EXECUTE FUNCTION prevent_menu_restaurant_mismatch();

-- 10. Order Status Transition State Machine
CREATE OR REPLACE FUNCTION enforce_order_status_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'placed' THEN
      RAISE EXCEPTION 'New orders must start in placed status';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'placed' AND NEW.status IN ('accepted', 'cancelled')) OR
    (OLD.status = 'accepted' AND NEW.status IN ('preparing', 'cancelled')) OR
    (OLD.status = 'preparing' AND NEW.status IN ('picked_up', 'cancelled')) OR
    (OLD.status = 'picked_up' AND NEW.status = 'delivered')
  ) THEN
    RAISE EXCEPTION 'Invalid order status transition: % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.status IN ('accepted', 'preparing', 'picked_up') AND NEW.partner_id IS NULL THEN
    RAISE EXCEPTION 'A delivery partner must be assigned before an order is accepted';
  END IF;
  IF NEW.status = 'delivered' THEN
    NEW.delivered_at = COALESCE(NEW.delivered_at, CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_status_transition ON orders;
CREATE TRIGGER order_status_transition BEFORE INSERT OR UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION enforce_order_status_transition();

-- 11. Review Eligibility
CREATE OR REPLACE FUNCTION enforce_review_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE order_id = NEW.order_id AND status = 'delivered') THEN
    RAISE EXCEPTION 'Only delivered orders can be reviewed';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_only_after_delivery ON reviews;
CREATE TRIGGER review_only_after_delivery BEFORE INSERT OR UPDATE ON reviews
FOR EACH ROW EXECUTE FUNCTION enforce_review_eligibility();
