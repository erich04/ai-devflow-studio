ALTER TABLE github_branch_publications
  ADD COLUMN source_publication_id text;

ALTER TABLE github_branch_publications
  ALTER COLUMN grant_id DROP NOT NULL;

ALTER TABLE github_branch_publications
  ADD CONSTRAINT github_branch_publications_source_fk
    FOREIGN KEY (source_publication_id) REFERENCES github_branch_publications(id),
  ADD CONSTRAINT github_branch_publications_authority_exactly_one CHECK (
    (grant_id IS NOT NULL AND source_publication_id IS NULL)
    OR (grant_id IS NULL AND source_publication_id IS NOT NULL)
  ),
  ADD CONSTRAINT github_branch_publications_adoption_shape CHECK (
    source_publication_id IS NULL
    OR (
      source_publication_id <> id
      AND status = 'verified'
      AND reported_outcome_code = 'already_present'
      AND verified_head_sha IS NOT NULL
      AND verified_at IS NOT NULL
      AND outcome_code = 'branch_verified'
    )
  );
