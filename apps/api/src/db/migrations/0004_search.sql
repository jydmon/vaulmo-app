-- Phase 5: search index for the AI assistant (RAG retrieval).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Denormalised searchable text per document (title + OCR + metadata + type).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_text text;

-- Full-text index for ranked retrieval, and a trigram index for fuzzy matching.
CREATE INDEX IF NOT EXISTS documents_fts_idx ON documents USING GIN (to_tsvector('english', coalesce(search_text, '')));
CREATE INDEX IF NOT EXISTS documents_trgm_idx ON documents USING GIN (search_text gin_trgm_ops);
