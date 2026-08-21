-- Machine-readable restriction window for no-parking zones (type = 'noparking').
-- schedule = { "days":[1,2,3,4,5]|null, "start":"08:00", "end":"18:30" }
--   days: 0=Sun..6=Sat (null/empty = every day); start/end = the RESTRICTED window
--   ("no parking / ticket risk"); outside it, parking is free.
ALTER TABLE charge_zones ADD COLUMN IF NOT EXISTS schedule jsonb;
