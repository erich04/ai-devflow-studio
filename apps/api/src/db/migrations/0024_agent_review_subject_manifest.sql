ALTER TABLE agent_reviews
  ADD COLUMN IF NOT EXISTS context_manifest jsonb;

COMMENT ON COLUMN agent_reviews.context_manifest IS
  'Redacted Review Subject/Criteria provenance: exact Artifact IDs, revisions, digests, coverage, and Knowledge identities; never raw subject content.';
