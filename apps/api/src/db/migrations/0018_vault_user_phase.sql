-- Vault user-phase: soft-delete, versioning, and per-field metadata provenance.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS replaced_by_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_version_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS metadata_sources jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Only current, non-deleted documents show in the active vault by default.
CREATE INDEX IF NOT EXISTS documents_active_idx
  ON documents (tenant_id)
  WHERE deleted_at IS NULL AND replaced_by_document_id IS NULL;
