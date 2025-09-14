-- Inpatient (病院版) 初期スキーマ
is_active BOOLEAN DEFAULT true,
created_at TIMESTAMPTZ DEFAULT now(),
updated_at TIMESTAMPTZ DEFAULT now(),
UNIQUE (room_id, code)
);
CREATE INDEX IF NOT EXISTS idx_beds_room ON beds(room_id);


CREATE TABLE IF NOT EXISTS admissions (
id BIGSERIAL PRIMARY KEY,
tenant_id BIGINT NOT NULL,
patient_id BIGINT NOT NULL,
admit_datetime TIMESTAMPTZ NOT NULL,
admit_source TEXT,
planned_flag BOOLEAN DEFAULT false,
created_at TIMESTAMPTZ DEFAULT now(),
updated_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE IF NOT EXISTS inpatient_stays (
id BIGSERIAL PRIMARY KEY,
admission_id BIGINT NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
start_at TIMESTAMPTZ NOT NULL,
end_at TIMESTAMPTZ,
CHECK (end_at IS NULL OR end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_stays_admission ON inpatient_stays(admission_id);


CREATE TABLE IF NOT EXISTS bed_assignments (
id BIGSERIAL PRIMARY KEY,
inpatient_stay_id BIGINT NOT NULL REFERENCES inpatient_stays(id) ON DELETE CASCADE,
bed_id BIGINT NOT NULL REFERENCES beds(id),
start TIMESTAMPTZ NOT NULL,
"end" TIMESTAMPTZ,
reason TEXT,
EXCLUDE USING gist (
bed_id WITH =,
tstzrange(start, COALESCE("end", 'infinity'::timestamptz)) WITH &&
)
);
CREATE INDEX IF NOT EXISTS idx_ba_bed ON bed_assignments(bed_id);


CREATE TABLE IF NOT EXISTS transfers (
id BIGSERIAL PRIMARY KEY,
inpatient_stay_id BIGINT NOT NULL REFERENCES inpatient_stays(id) ON DELETE CASCADE,
from_bed_id BIGINT REFERENCES beds(id),
to_bed_id BIGINT REFERENCES beds(id),
at TIMESTAMPTZ NOT NULL
);


CREATE TABLE IF NOT EXISTS discharges (
id BIGSERIAL PRIMARY KEY,
admission_id BIGINT NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
discharge_datetime TIMESTAMPTZ NOT NULL,
destination TEXT,
outcome TEXT
);