ALTER TABLE contact_cases ADD COLUMN wait_target TEXT;
ALTER TABLE contact_cases ADD COLUMN wait_reason TEXT
  CHECK (wait_reason IS NULL OR length(wait_reason) BETWEEN 1 AND 4000);
