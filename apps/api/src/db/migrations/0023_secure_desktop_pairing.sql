ALTER TABLE desktop_pairing_codes
  ADD COLUMN issued_role text;

UPDATE desktop_pairing_codes
SET issued_role = 'lead'
WHERE issued_role IS NULL;

ALTER TABLE desktop_pairing_codes
  ALTER COLUMN issued_role SET NOT NULL,
  ADD CONSTRAINT desktop_pairing_codes_issued_role_check
    CHECK (issued_role IN ('lead', 'member')),
  ADD COLUMN revoked_at timestamptz;

ALTER TABLE desktop_tokens
  ADD COLUMN issued_role text,
  ADD COLUMN expires_at timestamptz;

-- Pairing was lead-only before v23 and owner credentials were intentionally
-- reduced to lead capability, so lead is the only safe legacy upper bound.
UPDATE desktop_tokens
SET issued_role = 'lead'
WHERE issued_role IS NULL;

UPDATE desktop_tokens
SET expires_at = created_at + interval '30 days'
WHERE expires_at IS NULL;

ALTER TABLE desktop_tokens
  ALTER COLUMN issued_role SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL,
  ADD CONSTRAINT desktop_tokens_issued_role_check
    CHECK (issued_role IN ('lead', 'member'));

CREATE INDEX idx_desktop_pairing_codes_active_expiry
  ON desktop_pairing_codes(project_id, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_desktop_tokens_active_expiry
  ON desktop_tokens(project_id, expires_at)
  WHERE revoked_at IS NULL;
