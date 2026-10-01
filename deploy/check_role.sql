-- Diagnostic: why is the app role unable to authenticate?
SELECT rolname,
       rolsuper,
       rolcanlogin,
       rolbypassrls,
       rolconnlimit,
       rolvaliduntil
  FROM pg_authid
 WHERE rolname = 'lubric_app';

-- Does the password actually match what the container is sending?
SET password_encryption = 'md5';
SELECT rolname = 'lubric_app' AS is_app_role,
       rolpassword = 'md5' || md5('lubric_app_pw' || 'lubric_app') AS password_matches_md5,
       rolpassword LIKE 'SCRAM%' AS stored_as_scram
  FROM pg_authid
 WHERE rolname = 'lubric_app';