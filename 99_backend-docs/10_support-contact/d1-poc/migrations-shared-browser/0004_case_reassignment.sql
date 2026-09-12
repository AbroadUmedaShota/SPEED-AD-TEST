-- Existing references use NO ACTION and have no triggers. Preserve the circular
-- cases.last_request_id -> requests.case_id link until this migration commits.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE contact_api_requests_new (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor_email TEXT NOT NULL REFERENCES contact_operators(email),
  action TEXT NOT NULL CHECK (action IN (
    'assign-self', 'start', 'note', 'wait-customer', 'wait-internal',
    'hold', 'resolve', 'reopen', 'reassign'
  )),
  case_id TEXT NOT NULL REFERENCES contact_cases(case_id),
  expected_version INTEGER NOT NULL CHECK (expected_version > 0),
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE contact_case_events_new (
  event_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE REFERENCES contact_api_requests(request_id),
  case_id TEXT NOT NULL REFERENCES contact_cases(case_id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'assigned', 'started', 'note_added', 'wait_customer', 'wait_internal',
    'held', 'resolved', 'reopened', 'reassigned'
  )),
  actor_email TEXT NOT NULL REFERENCES contact_operators(email),
  from_version INTEGER NOT NULL CHECK (from_version > 0),
  to_version INTEGER NOT NULL,
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 4000),
  changes_json TEXT NOT NULL CHECK (json_valid(changes_json)),
  created_at TEXT NOT NULL,
  CHECK (to_version = from_version + 1),
  UNIQUE (case_id, to_version)
);

INSERT INTO contact_api_requests_new
  (request_id, actor_email, action, case_id, expected_version, payload_hash, response_json, created_at)
SELECT request_id, actor_email, action, case_id, expected_version, payload_hash, response_json, created_at
FROM contact_api_requests;

INSERT INTO contact_case_events_new
  (event_id, request_id, case_id, event_type, actor_email, from_version, to_version, note, changes_json, created_at)
SELECT event_id, request_id, case_id, event_type, actor_email, from_version, to_version, note, changes_json, created_at
FROM contact_case_events;

DROP TABLE contact_case_events;
DROP TABLE contact_api_requests;
ALTER TABLE contact_api_requests_new RENAME TO contact_api_requests;
ALTER TABLE contact_case_events_new RENAME TO contact_case_events;
CREATE INDEX contact_events_case_idx ON contact_case_events (case_id, to_version DESC);

PRAGMA defer_foreign_keys = OFF;
