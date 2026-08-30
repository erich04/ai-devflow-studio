ALTER TABLE coding_agent_summaries
  ADD COLUMN IF NOT EXISTS cost_details jsonb;

ALTER TABLE coding_agent_summaries
  DROP CONSTRAINT IF EXISTS coding_agent_summaries_cost_details_object_check;

ALTER TABLE coding_agent_summaries
  ADD CONSTRAINT coding_agent_summaries_cost_details_object_check
  CHECK (cost_details IS NULL OR jsonb_typeof(cost_details) = 'object');

COMMENT ON COLUMN coding_agent_summaries.cost_details IS
  'Immutable provider usage split, pricing snapshot, and settlement breakdown. NULL means legacy/unknown; never reprice historical rows.';
