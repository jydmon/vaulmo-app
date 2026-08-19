-- Family associations (FAM-02): tag a document to a family member / dependant.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS subject_member_id uuid REFERENCES family_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS documents_subject_member_idx ON documents (subject_member_id);

-- Privacy & Security Centre reuses the existing dsr_requests and consent_records
-- tables (self-serve export / deletion / consent). No new tables required.
