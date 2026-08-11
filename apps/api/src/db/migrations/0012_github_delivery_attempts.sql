ALTER TABLE github_delivery_requests
  ADD COLUMN delivery_series_key text,
  ADD COLUMN delivery_attempt integer;

UPDATE github_delivery_requests
SET
  delivery_series_key = logical_idempotency_key,
  delivery_attempt = 1;

ALTER TABLE github_delivery_requests
  ALTER COLUMN delivery_series_key SET NOT NULL,
  ALTER COLUMN delivery_attempt SET NOT NULL,
  ADD CONSTRAINT github_delivery_requests_delivery_series_shape CHECK (
    delivery_series_key ~ '^github-delivery:[a-f0-9]{64}$'
    AND delivery_attempt > 0
  ),
  ADD CONSTRAINT github_delivery_requests_series_attempt_unique
    UNIQUE (organization_id, project_id, delivery_series_key, delivery_attempt);
