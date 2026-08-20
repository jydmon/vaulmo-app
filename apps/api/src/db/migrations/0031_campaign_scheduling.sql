-- Campaigns can now target multiple audience groups, carry a rich-HTML body, and be
-- scheduled to send at a future time (processed by the worker tick).

ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'html';        -- html | text
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS audiences jsonb NOT NULL DEFAULT '[]'::jsonb; -- ['waitlist','contacts','users',...]
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;                    -- when to auto-send (null = send now/draft)

-- Backfill audiences from the legacy single-segment column so old campaigns still resolve.
UPDATE email_campaigns SET audiences = jsonb_build_array(segment)
 WHERE (audiences = '[]'::jsonb OR audiences IS NULL) AND segment IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_campaigns_scheduled_idx ON email_campaigns (status, scheduled_at);
