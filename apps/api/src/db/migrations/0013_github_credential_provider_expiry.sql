ALTER TABLE github_delivery_credential_grants
  ADD COLUMN provider_expiry_contract_version smallint NOT NULL DEFAULT 0,
  ADD COLUMN provider_credential_expires_at timestamptz,
  ADD COLUMN provider_expiry_observed_at timestamptz;

ALTER TABLE github_delivery_credential_grants
  ADD CONSTRAINT github_delivery_grants_provider_expiry_contract CHECK (
    (
      provider_expiry_contract_version = 0
      AND provider_credential_expires_at IS NULL
      AND provider_expiry_observed_at IS NULL
      AND outcome_code IS DISTINCT FROM 'credential_provider_expiry_confirmed'
    )
    OR
    (
      provider_expiry_contract_version = 1
      AND issued_at IS NOT NULL
      AND credential_expires_at IS NOT NULL
      AND provider_credential_expires_at IS NOT NULL
      AND credential_expires_at <= provider_credential_expires_at
      AND (
        (
          provider_expiry_observed_at IS NULL
          AND outcome_code IS DISTINCT FROM 'credential_provider_expiry_confirmed'
        )
        OR
        (
          provider_expiry_observed_at IS NOT NULL
          AND status = 'expired'
          AND outcome_code = 'credential_provider_expiry_confirmed'
          AND provider_expiry_observed_at >= provider_credential_expires_at + interval '2 seconds'
        )
      )
    )
  );
