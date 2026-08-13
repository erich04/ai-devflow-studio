ALTER TABLE agent_memory_summaries
  ADD COLUMN quality_version bigint NOT NULL DEFAULT 0 CHECK (
    quality_version BETWEEN 0 AND 2147483647
  );

ALTER TABLE agent_memory_summaries
  ADD CONSTRAINT agent_memory_summaries_quality_counts_are_exact
  CHECK (
    accepted_context_count <= retrieval_count AND
    (quality_version = 0 OR quality_version = accepted_context_count + 1)
  );

ALTER TABLE agent_memory_projection_audits
  DROP CONSTRAINT agent_memory_projection_audits_pkey;

ALTER TABLE agent_memory_projection_audits
  ADD COLUMN quality_version bigint NOT NULL DEFAULT 0 CHECK (
    quality_version BETWEEN 0 AND 2147483647
  );

ALTER TABLE agent_memory_projection_audits
  ADD PRIMARY KEY (memory_id, head_version, quality_version);
