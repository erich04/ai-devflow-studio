-- Original usage/settlements stay immutable. Corrections and late results append here.
CREATE TABLE model_cost_events (
  sequence bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  organization_id text NOT NULL REFERENCES organizations(id),
  project_id text NOT NULL REFERENCES projects(id),
  source_kind text NOT NULL CHECK (source_kind IN ('model_call', 'legacy_usage')),
  source_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reconciliation', 'settlement_conflict', 'settlement_confirmation')),
  idempotency_key text,
  json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, project_id, idempotency_key)
);
CREATE INDEX model_cost_events_source ON model_cost_events (organization_id, project_id, source_kind, source_id, sequence);
