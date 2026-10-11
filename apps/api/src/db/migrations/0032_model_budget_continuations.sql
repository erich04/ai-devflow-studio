-- Scoped future-spend approvals. These do not alter historical usage or bill evidence.
CREATE TABLE model_budget_continuations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  project_id text NOT NULL REFERENCES projects(id),
  user_id text NOT NULL REFERENCES users(id),
  json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX model_budget_continuations_scope ON model_budget_continuations (organization_id, project_id, user_id);
