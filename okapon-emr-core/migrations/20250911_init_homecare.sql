-- HomeCare/在宅 初期スキーマ
);


CREATE TABLE IF NOT EXISTS home_visit_occurrences (
id BIGSERIAL PRIMARY KEY,
tenant_id BIGINT NOT NULL,
patient_id BIGINT NOT NULL,
practitioner_id BIGINT NOT NULL,
scheduled TSTZRANGE NOT NULL,
status TEXT NOT NULL DEFAULT 'planned'
);
CREATE INDEX IF NOT EXISTS idx_hvo_prac_sched ON home_visit_occurrences USING gist (practitioner_id, scheduled);
ALTER TABLE home_visit_occurrences ADD CONSTRAINT no_overlap_per_practitioner EXCLUDE USING gist (
practitioner_id WITH =,
scheduled WITH &&
);


CREATE TABLE IF NOT EXISTS home_visit_checkins (
id BIGSERIAL PRIMARY KEY,
visit_id BIGINT NOT NULL REFERENCES home_visit_occurrences(id) ON DELETE CASCADE,
type TEXT NOT NULL CHECK (type IN ('in','out')),
at TIMESTAMPTZ NOT NULL,
geo POINT,
note TEXT
);


CREATE TABLE IF NOT EXISTS home_visit_tasks (
id BIGSERIAL PRIMARY KEY,
visit_id BIGINT NOT NULL REFERENCES home_visit_occurrences(id) ON DELETE CASCADE,
code TEXT,
label TEXT,
status TEXT DEFAULT 'planned',
result JSONB
);


CREATE TABLE IF NOT EXISTS alerts (
id BIGSERIAL PRIMARY KEY,
tenant_id BIGINT NOT NULL,
patient_id BIGINT NOT NULL,
type TEXT NOT NULL,
value TEXT,
severity TEXT,
at TIMESTAMPTZ NOT NULL DEFAULT now(),
handled BOOLEAN DEFAULT false
);


CREATE TABLE IF NOT EXISTS device_readings (
id BIGSERIAL PRIMARY KEY,
tenant_id BIGINT NOT NULL,
patient_id BIGINT NOT NULL,
device_code TEXT,
metric TEXT,
value TEXT,
unit TEXT,
at TIMESTAMPTZ NOT NULL
);
