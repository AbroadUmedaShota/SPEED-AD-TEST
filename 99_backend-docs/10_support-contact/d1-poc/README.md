# D1 atomic note proof of concept

This is a local-only consistency and operator-flow experiment, not a deployment candidate.
It implements the approved fixed case actions and an operator UI over synthetic data.
The six existing status values are preserved without adding priority, archive, SLA or
notification rules.
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
The accepted local evidence is mapped in
[LOCAL_MVP_ACCEPTANCE.md](LOCAL_MVP_ACCEPTANCE.md), and the proposed shared-trial
architecture and approval gates are in
[SHARED_TRIAL_EXECUTION_PACKAGE.md](SHARED_TRIAL_EXECUTION_PACKAGE.md).

The architecture-only decision for the initial workers.dev shared trial is
Workers + D1 + Cloudflare Access with exact-email Google identities, Worker-side
JWT verification, and an active-operator check in D1. It has attachments
disabled and no R2 binding or subscription. Private R2 attachments are a
deferred G7 full candidate, not part of the initial trial. The isolated initial
entry point is [`sharedWorker.mjs`](sharedWorker.mjs), with a selector-free UI
under [`shared-ui`](shared-ui/index.html). The existing
[`wrangler.shared.example.jsonc`](wrangler.shared.example.jsonc) remains the
separate custom-domain/R2 candidate. The workers.dev bootstrap profile is
[`wrangler.shared-trial-bootstrap.example.jsonc`](wrangler.shared-trial-bootstrap.example.jsonc):
it has no bindings or assets and returns only `503 {"error":"trial_disabled"}`
with `Cache-Control: no-store`. The non-custom-domain trial profile is
[`wrangler.shared-trial.example.jsonc`](wrangler.shared-trial.example.jsonc): it
has ASSETS and D1 placeholders, starts disabled, and has no R2 binding. The
required shared-trial command includes the new boundary suite and the directly
affected shared suites:

```powershell
node --test --test-concurrency=1 tests/shared-trial-boundary.test.mjs tests/shared-worker.test.mjs tests/shared-ui-request-state.test.mjs tests/shared-boundary.test.mjs
```

`npm run test:shared` remains useful for its existing suite but does not include
`tests/shared-trial-boundary.test.mjs`. These files do not authorize or perform
resource creation, deployment, real-account registration or data migration.

The repeatable browser-only harness is
[`wrangler.shared-browser.jsonc`](wrangler.shared-browser.jsonc) with its entry
point under `tests/`. It requires a runtime-generated test JWT and injected
public JWKS, uses only local D1/R2 and must never be deployed. The completed
browser scenarios and bounded G1 metadata findings are recorded in
[`SHARED_LOCAL_BROWSER_ACCEPTANCE.md`](SHARED_LOCAL_BROWSER_ACCEPTANCE.md).

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
includes invalid and past dates, exact input boundaries, state preconditions,
idempotency conflicts, deterministic concurrent waits and full rollback after
an event constraint failure.

For replay compatibility, the three operations shipped in commit `c4ecb97`
(`assign-self`, `start`, `note`) retain their original canonical hash format.
New wait operations hash a sorted list of every accepted business field. An
upgrade test seeds an old-format immutable receipt, applies the current schema,
and verifies that the same request still replays without another event.

The approved resolution slice implements fixed `resolve` and `reopen` actions.
Resolution requires an assignee, one of `解決` / `案内完了` / `対応不要`, and a
final note. If pending wait fields exist, an explicit completion note is also
required; the immutable event records every cleared value before the current
case fields are reset. Reopen requires a reason, returns the case to `対応中`,
and records the previous resolution while preserving all earlier events.

`reopen` requires an assignee and a reason. It returns `対応済み` cases with complete
resolution metadata, plus `顧客確認待ち`, `引継ぎ待ち` and `保留` cases, to `対応中`.
For every wait-state reopen it clears `next_action`, `followup_at`, `wait_target`
and `wait_reason` in the same atomic update; the receipt/event preserves the
pre-clear values and reopening reason. The existing resolved-case reopen receipt
continues to preserve its previous resolution metadata.

The local MVP suite now has 57 tests. It covers UI asset routing and deterministic
late-response rejection after wait, resolution and operator changes,
resolve/reopen/re-resolve,
invalid states and inputs, replay and request-ID conflicts, deterministic
concurrent resolution, event-failure rollback and updates by another allowed
operator. Reopen is independently covered for replay, concurrent updates,
event-failure rollback, and incomplete legacy resolution metadata. A separate
temporary D1 applies migration `0001`, inserts a synthetic
case with an old-format receipt and event, then applies `0002`; the test verifies
the row, receipt, event count and foreign keys after the ordered upgrade.

The local attachment boundary stores one valid synthetic WebP outside the static
UI assets. Case detail returns safe metadata only. The authenticated fixed
content endpoint verifies the active operator, attachment/case relation, case
state, blob presence, byte size and SHA-256 before returning bytes with
`Cache-Control: no-store`, `nosniff` and a restrictive CSP. Unknown IDs,
malformed paths, disabled principals, archived cases and missing or corrupted
blobs are rejected without returning attachment bytes. The UI creates a
temporary `blob:` URL only after an operator requests a preview, and revokes and
removes it when the case or operator changes.

The restore test exports only the five formal `contact_*` tables from a synthetic
source D1 database. It applies migrations `0001` and `0002` in order to a new,
independent target database and imports the data there; it never overwrites or
deletes the source. It then verifies all table rows, foreign keys, case version,
history, an old-format payload hash, exact immutable receipt replay and that the
replay causes no mutation. Attachment bytes are exported separately with a
manifest and must match the D1 attachment ID, case ID, object key, size and
SHA-256 during restore. A DB-only restore with a missing, corrupt or mismatched
blob fails validation.

## Local operator UI

Apply the local migrations and start the MVP Worker from this directory:

```powershell
npx wrangler d1 migrations apply DB --local --config wrangler.mvp.jsonc
npx wrangler dev --local --config wrangler.mvp.jsonc
```

Open the loopback URL printed by Wrangler. The interface provides the four
approved queues, delayed detail/history loading and the eight fixed operations.
It uses only the two synthetic operators from the local Worker. Selecting
`認証なし（検証用）` proves the failure state; it is not an authentication
implementation or a shared-login substitute.

Unsaved form values and acknowledgement-uncertain request IDs stay only in the
current page memory. They are never written to browser storage or the URL.
Version conflicts reload the latest case while retaining the draft, require the
operator to review it and never resubmit automatically. API values are rendered
through DOM text nodes rather than HTML injection.

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
  only synthetic cases and operators (`operator-a`, `operator-b`).
- The HTTP wrapper is tested both in-process and through local workerd. Production
  request streaming limits, CSRF controls, routing/authentication and deployment
  configuration remain separate work.
- No idempotency expiry or cleanup is introduced. A production retention policy
  requires separate design; deleting receipt records changes replay guarantees.
- The nonpublic attachment and DB/file restore contracts are verified only with
  local synthetic data. A shared attachment service, remote restore rehearsal,
  real authentication and shared trial remain unfinished.
