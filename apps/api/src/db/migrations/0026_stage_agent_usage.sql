-- Stage calls, including rejected output, are consumption records independent of Gate results.
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS stage_agent_usage jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE token_usage ALTER COLUMN cost_usd DROP NOT NULL;
ALTER TABLE agent_token_usage ALTER COLUMN cost_usd DROP NOT NULL;
ALTER TABLE agent_token_usage DROP CONSTRAINT IF EXISTS agent_token_usage_source_check;
ALTER TABLE agent_token_usage ADD CONSTRAINT agent_token_usage_source_check CHECK (source IN ('provider_reported', 'estimated', 'unknown'));
ALTER TABLE workflow_runs ADD CONSTRAINT stage_agent_usage_object CHECK (jsonb_typeof(stage_agent_usage) = 'object');
