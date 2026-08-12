ALTER TABLE github_pull_request_outcomes
  ADD COLUMN provider_retry_not_before timestamptz;

ALTER TABLE github_pull_request_outcomes
  ADD CONSTRAINT github_pull_request_outcomes_retry_after CHECK (
    provider_retry_not_before IS NULL
    OR (
      status = 'recovery_required'
      AND outcome_code = 'pull_request_failed'
      AND provider_retry_not_before > recorded_at
      AND provider_retry_not_before <= recorded_at + interval '24 hours'
    )
  );
