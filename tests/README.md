# Save test (end to end)

`tests/run-e2e.sh` signs people up, imports the team, clocks in and out, edits and approves shifts, uploads photos and an
announcement image, requests and approves time off, runs a full Year End Review, resets passwords, checks that phones
can't clock in, and then **reads every change back from the database and through the API**. It also builds a brand-new
database from scratch, so a fresh Neon project is covered.

It uses a local Postgres instead of Neon (same SQL, via a tiny stand-in for the Neon driver), and it **wipes the test
database** first, so never point it at production.

```bash
# needs Node 20+ and a Postgres you can create a database in
createdb pltc_test
TEST_DATABASE_URL=postgres://you@localhost:5432/pltc_test tests/run-e2e.sh
```

Each step prints ✓ or ✗ and the run ends with `N passed, 0 failed`.
