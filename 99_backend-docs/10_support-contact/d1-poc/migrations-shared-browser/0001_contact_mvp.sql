CREATE TABLE contact_operators (
  email TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE contact_cases (
  case_id TEXT PRIMARY KEY NOT NULL,
  received_at TEXT NOT NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  message TEXT NOT NULL,
  source_url TEXT,
  user_agent TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留', '対応済み')
  ),
  priority TEXT NOT NULL DEFAULT '中' CHECK (priority IN ('高', '中', '低')),
  assignee_email TEXT REFERENCES contact_operators(email),
  next_action TEXT CHECK (next_action IS NULL OR length(next_action) BETWEEN 1 AND 200),
  followup_at TEXT,
  resolution_code TEXT,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES contact_operators(email),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_request_id TEXT REFERENCES contact_api_requests(request_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archived_by TEXT REFERENCES contact_operators(email)
);

CREATE TABLE contact_api_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor_email TEXT NOT NULL REFERENCES contact_operators(email),
  action TEXT NOT NULL CHECK (action IN (
    'assign-self', 'start', 'note', 'wait-customer', 'wait-internal',
    'hold', 'resolve', 'reopen'
  )),
  case_id TEXT NOT NULL REFERENCES contact_cases(case_id),
  expected_version INTEGER NOT NULL CHECK (expected_version > 0),
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE contact_case_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE REFERENCES contact_api_requests(request_id),
  case_id TEXT NOT NULL REFERENCES contact_cases(case_id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'assigned', 'started', 'note_added', 'wait_customer', 'wait_internal',
    'held', 'resolved', 'reopened'
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

CREATE TABLE contact_attachments (
  attachment_id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL REFERENCES contact_cases(case_id),
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX contact_cases_queue_idx
  ON contact_cases (archived_at, status, assignee_email, followup_at, received_at);
CREATE INDEX contact_cases_received_idx ON contact_cases (received_at DESC, case_id);
CREATE INDEX contact_events_case_idx ON contact_case_events (case_id, to_version DESC);
CREATE INDEX contact_attachments_case_idx ON contact_attachments (case_id, attachment_id);
