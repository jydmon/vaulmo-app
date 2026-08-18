-- Document Catalogue configuration: per-type reminder schedules + archive flag.
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS reminder_lead_days integer[] NOT NULL DEFAULT '{180,90,30,7}';
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
