CREATE TABLE poc_operators (
  actor_id TEXT PRIMARY KEY NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1))
);

CREATE TABLE poc_cases (
  case_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留', '対応済み')
  ),
  version INTEGER NOT NULL CHECK (version > 0),
  last_request_id TEXT REFERENCES poc_requests(request_id),
  updated_at TEXT NOT NULL
);

CREATE TABLE poc_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES poc_operators(actor_id),
  action TEXT NOT NULL CHECK (action = 'append_note'),
  case_id TEXT NOT NULL REFERENCES poc_cases(case_id),
  expected_version INTEGER NOT NULL CHECK (expected_version > 0),
  payload_hash TEXT NOT NULL,
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json))
);

CREATE TABLE poc_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE REFERENCES poc_requests(request_id),
  case_id TEXT NOT NULL REFERENCES poc_cases(case_id),
  actor_id TEXT NOT NULL REFERENCES poc_operators(actor_id),
  from_version INTEGER NOT NULL CHECK (from_version > 0),
  to_version INTEGER NOT NULL,
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  CHECK (to_version = from_version + 1),
  UNIQUE (case_id, to_version)
);

CREATE TABLE poc_faults (
  fault TEXT PRIMARY KEY NOT NULL CHECK (fault = 'event_insert')
);

CREATE TRIGGER poc_fail_event
BEFORE INSERT ON poc_events
WHEN EXISTS (
  SELECT 1
  FROM poc_faults
  WHERE fault = 'event_insert'
)
BEGIN
  SELECT RAISE(ABORT, 'injected history failure');
END;
