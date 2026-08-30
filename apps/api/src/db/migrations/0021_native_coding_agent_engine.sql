ALTER TABLE coding_agent_summaries
  DROP CONSTRAINT IF EXISTS coding_agent_summaries_engine_check;

ALTER TABLE coding_agent_summaries
  ADD CONSTRAINT coding_agent_summaries_engine_check
  CHECK (engine IN ('fake', 'native', 'opencode-http', 'opencode-acp'));
