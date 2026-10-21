#!/bin/sh
# Run only against a new, isolated cluster. The official image runs this on its
# first initialization; existing databases are deliberately never reset.
set -eu

: "${POSTGRES_USER:?Set the bootstrap administrator role}"
: "${POSTGRES_DEV_PASSWORD:?Set the development role password}"
: "${POSTGRES_TEST_PASSWORD:?Set the test role password}"

psql --username "$POSTGRES_USER" --dbname postgres --no-psqlrc \
  --set=ON_ERROR_STOP=1 <<'SQL'
\getenv dev_password POSTGRES_DEV_PASSWORD
\getenv test_password POSTGRES_TEST_PASSWORD
CREATE ROLE instagram_dev LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'dev_password';
CREATE ROLE instagram_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'test_password';
CREATE DATABASE instagram_dev OWNER instagram_dev;
CREATE DATABASE instagram_test OWNER instagram_test;
REVOKE ALL ON DATABASE instagram_dev FROM PUBLIC;
REVOKE ALL ON DATABASE instagram_test FROM PUBLIC;
GRANT CONNECT ON DATABASE instagram_dev TO instagram_dev;
GRANT CONNECT ON DATABASE instagram_test TO instagram_test;
SQL
