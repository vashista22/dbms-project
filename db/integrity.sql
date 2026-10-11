-- Apply after schema.sql. These triggers enforce cross-row business rules.
CREATE OR REPLACE FUNCTION enforce_order_item_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_restaurant integer; item_restaurant integer; available boolean;
BEGIN
  SELECT restaurant_id INTO order_restaurant FROM orders WHERE order_id=NEW.order_id;
  SELECT restaurant_id,is_available INTO item_restaurant,available FROM menu_items WHERE item_id=NEW.item_id;
  IF order_restaurant IS NULL OR item_restaurant IS DISTINCT FROM order_restaurant THEN RAISE EXCEPTION 'Order items must come from the order restaurant'; END IF;
  IF available IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Menu item is unavailable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_item_business_rules ON order_items;
CREATE TRIGGER order_item_business_rules BEFORE INSERT OR UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION enforce_order_item_rules();

CREATE OR REPLACE FUNCTION prevent_order_restaurant_mismatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM order_items oi JOIN menu_items m USING (item_id)
             WHERE oi.order_id=OLD.order_id AND m.restaurant_id IS DISTINCT FROM NEW.restaurant_id) THEN
    RAISE EXCEPTION 'An order restaurant cannot change while its items belong to another restaurant';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_restaurant_scope ON orders;
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
DROP TRIGGER IF EXISTS menu_item_restaurant_scope ON menu_items;
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
DROP TRIGGER IF EXISTS order_status_transition ON orders;
CREATE TRIGGER order_status_transition BEFORE INSERT OR UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION enforce_order_status_transition();

CREATE OR REPLACE FUNCTION enforce_review_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE order_id=NEW.order_id AND status='delivered') THEN RAISE EXCEPTION 'Only delivered orders can be reviewed'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_only_after_delivery ON reviews;
CREATE TRIGGER review_only_after_delivery BEFORE INSERT OR UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION enforce_review_eligibility();
