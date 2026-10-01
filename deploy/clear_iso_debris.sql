-- Clear isolation-test debris.
--
-- The isolation run that failed on its admin connection could not delete its
-- ISO-A / ISO-B markers, so they survived as real customers with no price list.
-- e2e_price_lists.js caught them, which is the suite doing its job.
DELETE FROM customers WHERE name IN ('ISO-A', 'ISO-B') OR name LIKE 'UNMEMBERED-%';

-- Report anything else that has no price list, which would be a real gap.
SELECT c.id, c.name, c.customer_type, c.shop_id
  FROM customers c
  LEFT JOIN party_price_lists pll
    ON pll.party_type = 'customer' AND pll.party_id = c.id
 WHERE pll.party_id IS NULL;