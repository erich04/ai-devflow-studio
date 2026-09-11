-- Metadata only; local request and Artifact bodies remain in Desktop.
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS gate_review_subject jsonb;
ALTER TABLE gate_commands ADD COLUMN IF NOT EXISTS review_subject jsonb;
ALTER TABLE workflow_runs ADD CONSTRAINT gate_review_subject_object
  CHECK (gate_review_subject IS NULL OR jsonb_typeof(gate_review_subject) = 'object');
ALTER TABLE gate_commands ADD CONSTRAINT gate_command_review_subject_object
  CHECK (review_subject IS NULL OR jsonb_typeof(review_subject) = 'object');
