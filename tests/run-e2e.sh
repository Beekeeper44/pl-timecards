#!/usr/bin/env bash
# Runs tests/e2e.mjs against a local Postgres instead of Neon (same SQL), so every save can be checked for real.
# Usage: TEST_DATABASE_URL=postgres://user@localhost:5432/pltc_test tests/run-e2e.sh   (the database is wiped first)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TEST_DATABASE_URL:-postgres://postgres@localhost:5432/pltc_test}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cp -r "$ROOT/api" "$ROOT/tests/e2e.mjs" "$T/"
cd "$T"
printf '{"type":"module","private":true}' > package.json
npm install --silent pg@8.11.3 >/dev/null
mkdir -p node_modules/@neondatabase/serverless
printf '{"name":"@neondatabase/serverless","type":"module","main":"index.js"}' > node_modules/@neondatabase/serverless/package.json
cat > node_modules/@neondatabase/serverless/index.js <<'JS'
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
export function neon() { return async (s, ...v) => { let t = s[0]; for (let i = 0; i < v.length; i++) t += "$" + (i + 1) + s[i + 1]; return (await pool.query(t, v)).rows; }; }
export const __pool = pool;
JS
node -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.argv[1]});await c.connect();await c.query('drop schema public cascade; create schema public');await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})" "$DB"
TEST_DATABASE_URL="$DB" PLTC_ROOT="$ROOT" node e2e.mjs
