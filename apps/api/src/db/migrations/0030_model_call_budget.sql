CREATE TABLE model_call_attempts (
 id text PRIMARY KEY,
 organization_id text NOT NULL REFERENCES organizations(id),
 project_id text NOT NULL REFERENCES projects(id),
 user_id text NOT NULL REFERENCES users(id),
 json jsonb NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE INDEX model_call_attempts_project ON model_call_attempts(organization_id,project_id,created_at);
ALTER TABLE token_usage ADD COLUMN budget_attempt_ids jsonb;
