ALTER TABLE agent_provider_credentials
  ADD COLUMN IF NOT EXISTS provider_name text;

UPDATE agent_provider_credentials
SET provider_name = CASE
  WHEN provider_id = 'openai-default' THEN 'OpenAI Compatible'
  ELSE provider_id
END
WHERE provider_name IS NULL OR btrim(provider_name) = '';

ALTER TABLE agent_provider_credentials
  ALTER COLUMN provider_name SET NOT NULL;
