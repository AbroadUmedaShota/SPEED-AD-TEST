# D1 atomic note proof of concept

This is a local-only consistency experiment, not a deployment candidate.
The only action is appending a synthetic note. The six existing status values
are preserved without adding or changing transition, priority, archive or resolution rules.
The Worker listener and D1 binding are local-only test adapters. The configuration
contains no credential or deployable D1 resource identifier and rejects non-loopback requests.

## Run

From the repository root, using Node.js 24.13.0 or a compatible runtime with
`node:sqlite`:

```powershell
node --test tests/support-contact-d1-atomicity.test.mjs
```

The tests use SQLite 3.50.4 through Node's experimental built-in SQLite API.
No packages need installing. Worker-thread tests use two connections to a
temporary SQLite file, synchronize both requests immediately before their
batches, and remove only that per-test temporary directory after both workers exit.

For the local D1 binding verification, install the exact PoC dependency and run:

```powershell
cd 99_backend-docs/10_support-contact/d1-poc
npm ci
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_SEND_ERROR_REPORTS = 'false'
npm run test:d1
```

This uses the project-local `wrangler@4.129.0` binary (Node.js 22 or newer),
applies the migration to a unique temporary persistence directory, starts
workerd on an ephemeral loopback port with all bindings local, then removes the
temporary directory. The test does not log in, inspect account state, create a
remote D1 database or deploy a Worker. Wrangler state and `node_modules` are ignored.

The proposed scope that consumes this verified atomicity contract is documented
in [MVP_IMPLEMENTATION_PACKAGE.md](MVP_IMPLEMENTATION_PACKAGE.md). It keeps the
local, shared-trial and production completion gates separate; it does not approve
external resources, authentication, cost, production data or deployment.

The first approved local vertical slice uses the separate
[`migrations-mvp`](migrations-mvp/0001_contact_mvp.sql) schema and
[`mvpWorker.mjs`](mvpWorker.mjs). Run it with:

```powershell
npm run test:mvp
```

It creates exactly five formal `contact_*` tables and tests the synthetic flow
`unassigned -> assign self -> start -> append note -> read history`. The tests
also cover deterministic post-preflight concurrency, SQL-failure rollback,
stale versions, replay and idempotency conflicts, acknowledgement loss, updates
by another allowed operator, preservation of all six statuses, actor spoofing,
unsupported actions, and rejecting missing or disabled principals before parsing
their bodies. The MVP configuration remains local-only and does not select a
shared authentication or attachment service.

The approved wait-management slice adds migration `0002_wait_management.sql`
and fixed `wait-customer`, `wait-internal` and `hold` actions. It keeps the
assignee while storing the reason, next action, follow-up date and optional
internal target in the same atomic update and immutable event. The local suite
now has 25 tests, including invalid and past dates, exact input boundaries, state preconditions,
idempotency conflicts, deterministic concurrent waits and full rollback after
an event constraint failure. `resolve` and `reopen` are approved MVP operations
but remain unimplemented in this slice.

For replay compatibility, the three operations shipped in commit `c4ecb97`
(`assign-self`, `start`, `note`) retain their original canonical hash format.
New wait operations hash a sorted list of every accepted business field. An
upgrade test seeds an old-format immutable receipt, applies the current schema,
and verifies that the same request still replays without another event.

## SQL contract

[Migration](migrations/0001_atomic_note.sql) defines five isolated `poc_*` tables.
The fifth table and its trigger are only a deterministic local failure-injection
hook; the production schema decision remains outside this PoC.
The fixed API in [atomicNote.mjs](atomicNote.mjs) uses bound parameters for:

1. A plain INSERT into `poc_requests` with the request identity and complete
   immutable success receipt. There is no IGNORE, REPLACE or UPSERT.
2. An UPDATE of `version`, `last_request_id`, `updated_at`, matching both
   `case_id` and `expectedVersion`.
3. An unconditional one-row INSERT into `poc_events`:

```sql
INSERT INTO poc_events
  (event_id, request_id, case_id, actor_id, from_version, to_version, note, created_at)
VALUES (?, ?, ?, ?, ?,
  (SELECT version FROM poc_cases
   WHERE case_id = ? AND version = ? + 1 AND last_request_id = ?),
  ?, ?);
```

`to_version` is NOT NULL, and has `CHECK (to_version = from_version + 1)`.
If the case UPDATE matches zero rows, the scalar subquery has no result and
evaluates to NULL. The unconditional INSERT therefore raises an SQL error.
This differs from `INSERT ... SELECT`, which can succeed while inserting zero rows.

The request also references an existing case; a nonexistent case is rejected
at that earlier INSERT. The cases' last-request marker references a real request.
These foreign keys supplement the zero-update guard. They cannot prove that
every request has a matching event, so stale versions still require the guard.
Queryable note/time columns and a JSON validity constraint protect receipt metadata.

All three statements must execute inside one D1 `batch()`. D1 documents that
a statement failure rolls back the whole sequence. The local adapter models
this with `BEGIN IMMEDIATE / COMMIT / ROLLBACK`; those transaction commands
are only in the SQLite test harness, not the D1 binding code.
References: [D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[SQLite scalar subqueries](https://www.sqlite.org/lang_expr.html#subquery_expressions).

No success is returned from a failed batch unless an already committed matching
request can be read. Error classification order:

| Stored state after failure | API result |
| --- | --- |
| Request ID exists and actor/action/case/version/payload hash match | 200, exact stored receipt |
| Request ID exists with different content or actor | 409, idempotency conflict |
| No request and no case | 404 |
| No request and case version differs | 409, version conflict |
| State cannot be read, or failure cannot be classified | 503 |

An unsupported action/extra field is rejected before mutation (400, or 404 for
an unsupported route). It is not a second valid action with idempotency semantics.
The canonical hash uses a fixed array of actor/action/case/version/note, so JSON
property order is irrelevant; note text is preserved exactly.
The receipt is an event acknowledgement, not a current case snapshot.
After subsequent updates, replay still returns the original receipt.

## Verification coverage

The SQLite model has 20 tests covering normal success, missing case, stale/future version, identical
replay, changed note/case/version/actor, failure while writing the request or
event, acknowledgement loss, unavailable follow-up reads, unauthorized synthetic
actors, payload validation, preservation of all six statuses, and the zero-row
INSERT SELECT negative control.

Three races use separate SQLite connections and a barrier after both preflight
reads: different IDs, same ID/same payload, same ID/different payload.
The tests inspect the case, request and history tables, including orphan rows
and duplicate events.

The local D1 binding has seven integration tests covering:

1. CAS mismatch causing the NOT NULL guard to fail and roll back the whole batch.
2. Two concurrent HTTP requests held at a deterministic post-preflight barrier,
   covering different IDs, same ID/same payload and same ID/different payload.
3. Retry after simulated acknowledgement loss returning the stored receipt with
   one request and one history event.
4. Triggered history-write failure rolling back request, case update and event.
5. Rejection of a non-loopback Host before test or action routing.

## Limits and next validation

- SQLite 3.50.4 modeling and local workerd/D1 binding execution both pass, but
  remote D1, network partitions, replica lag and Cloudflare account configuration
  remain untested.
- The caller injects an already authenticated synthetic actor. Google login,
  JWT verification, Access policies and revocation during a pending request
  are not implemented or accepted by this experiment.
- A production D1 adapter must preserve primary-consistent replay/error
  reconciliation; distributed failure behavior remains untested.
- The PoC schema is not a migration of the existing Spreadsheet. It contains
  only synthetic cases and operators (`demo-a`, `demo-b`).
- The HTTP wrapper is tested both in-process and through local workerd. Production
  request streaming limits, CSRF controls, routing/authentication and deployment
  configuration remain separate work.
- No idempotency expiry or cleanup is introduced. A production retention policy
  requires separate design; deleting receipt records changes replay guarantees.
- Nonpublic attachment storage, DB/file restore, new UI and shared trial remain unfinished.
