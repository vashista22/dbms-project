-- Demo IDs are stable for a freshly initialized schema.
INSERT INTO users(user_id,name,email,phone,role) VALUES
 (1,'Demo Customer','customer@example.test','9000000001','customer'),
 (2,'Demo Owner','owner@example.test','9000000002','owner'),
 (3,'Demo Partner','partner@example.test','9000000003','partner'),
 (4,'Demo Admin','admin@example.test','9000000004','admin') ON CONFLICT DO NOTHING;
INSERT INTO addresses(user_id,address_no,label,line,city,pincode) VALUES(1,1,'Home','12 Sample Road','Bengaluru','560001') ON CONFLICT DO NOTHING;
INSERT INTO restaurants(restaurant_id,owner_id,name,city,address,is_open,avg_rating) VALUES
 (1,2,'Masala Junction','Bengaluru','MG Road, Bengaluru',true,4.40) ON CONFLICT DO NOTHING;
INSERT INTO cuisines(cuisine_id,name) VALUES(1,'Indian'),(2,'South Indian') ON CONFLICT DO NOTHING;
INSERT INTO restaurant_cuisines(restaurant_id,cuisine_id) VALUES(1,1),(1,2) ON CONFLICT DO NOTHING;
INSERT INTO menu_items(item_id,restaurant_id,name,price,is_veg,is_available) VALUES
 (1,1,'Paneer Biryani',220,true,true),(2,1,'Masala Dosa',120,true,true),(3,1,'Chicken Biryani',260,false,true) ON CONFLICT DO NOTHING;
INSERT INTO delivery_partners(partner_id,vehicle_no,city,status) VALUES(3,'KA-01-DEMO','Bengaluru','available') ON CONFLICT DO NOTHING;
INSERT INTO coupons(code,discount_pct,max_discount,min_order,valid_from,valid_to) VALUES
 ('WELCOME20',20,100,200,CURRENT_DATE-1,CURRENT_DATE+365) ON CONFLICT DO NOTHING;
-- Keep generated IDs aligned after explicit demo IDs.
SELECT setval(pg_get_serial_sequence('users','user_id'),GREATEST((SELECT COALESCE(MAX(user_id),1) FROM users),1));
SELECT setval(pg_get_serial_sequence('restaurants','restaurant_id'),GREATEST((SELECT COALESCE(MAX(restaurant_id),1) FROM restaurants),1));
SELECT setval(pg_get_serial_sequence('cuisines','cuisine_id'),GREATEST((SELECT COALESCE(MAX(cuisine_id),1) FROM cuisines),1));
SELECT setval(pg_get_serial_sequence('menu_items','item_id'),GREATEST((SELECT COALESCE(MAX(item_id),1) FROM menu_items),1));
