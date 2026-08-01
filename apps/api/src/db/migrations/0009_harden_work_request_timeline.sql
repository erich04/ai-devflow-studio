ALTER TABLE work_requests
  DROP CONSTRAINT work_requests_time_order;

ALTER TABLE work_requests
  ADD CONSTRAINT work_requests_time_order CHECK (
    updated_at >= created_at
    AND (expires_at IS NULL OR expires_at > created_at)
    AND (status <> 'expired' OR expires_at IS NOT NULL)
    AND (status <> 'expired' OR updated_at >= expires_at)
    AND (claimed_at IS NULL OR claimed_at >= created_at)
    AND (claimed_at IS NULL OR expires_at IS NULL OR claimed_at < expires_at)
    AND (claimed_at IS NULL OR updated_at >= claimed_at)
    AND (materialized_at IS NULL OR materialized_at >= claimed_at)
    AND (materialized_at IS NULL OR updated_at >= materialized_at)
  );
