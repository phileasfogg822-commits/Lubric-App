-- Force the app role's password to a known value and prove it over TCP.
--
-- The loopback rules in pg_hba.conf are `trust`, so testing over 127.0.0.1
-- proves NOTHING about the password - it is never checked. Only a non-loopback
-- connection exercises the scram-sha-256 rule the app actually goes through.
ALTER ROLE lubric_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'lubric_app_pw';

SELECT rolname,
       rolsuper,
       rolbypassrls,
       rolcanlogin,
       rolpassword LIKE 'SCRAM%' AS stored_scram
  FROM pg_authid
 WHERE rolname = 'lubric_app';