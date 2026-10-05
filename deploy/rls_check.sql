SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS force
  FROM pg_class
 WHERE relname IN ('config', 'feature_flags');
SELECT schemaname, tablename FROM pg_policies
 WHERE policyname = 'shop_isolation' AND tablename IN ('config', 'feature_flags');
SELECT count(*) AS shop_isolation_policies FROM pg_policies WHERE policyname = 'shop_isolation';
