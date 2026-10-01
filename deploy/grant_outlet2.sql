-- Grant the admin to the placeholder outlet, so the selector is reachable and
-- the isolation has a second real membership to validate against.
INSERT INTO user_shops (user_id, shop_id, role)
SELECT id, 2, role FROM users WHERE email = 'admin@lubric.app'
ON CONFLICT (user_id, shop_id) DO NOTHING;

SELECT u.email, us.shop_id, s.name, us.role
  FROM user_shops us
  JOIN users u ON u.id = us.user_id
  JOIN shops s ON s.id = us.shop_id
 ORDER BY u.email, us.shop_id;