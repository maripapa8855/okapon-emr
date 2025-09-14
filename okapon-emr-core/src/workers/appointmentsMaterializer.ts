// okapon-emr-core/src/workers/appointmentsMaterializer.ts
// 差控え版（安全運用向け）
// - facility_id は DBに保存しない方針
// - created は在宅判定（facility）を通ったときのみ作成
// - canceled は facility の有無に依存せず必ず反映（取りこぼし防止）
// - 重複/重なり（GiST除外・一意制約）は静かに無視してループ継続

import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

function isHomecareFacility(fid: unknown) {
  const set = new Set(
    (process.env.OKAPON_HOMECARE_FACILITY_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (fid === undefined || fid === null) return false;
  return set.has(String(fid));
}

async function getOrCreatePatientId(extKey: string) {
  const src = "reservations";

  const q1 = await pool.query(
    `SELECT patient_id FROM ext_patient_map WHERE ext_source=$1 AND ext_key=$2`,
    [src, extKey]
  );
  if (q1.rowCount > 0) return Number(q1.rows[0].patient_id);

  const q2 = await pool.query(
    `INSERT INTO ext_patient_map (ext_source, ext_key, patient_id)
     VALUES ($1,$2,nextval('patient_synth_id_seq'))
     ON CONFLICT (ext_source, ext_key) DO NOTHING
     RETURNING patient_id`,
    [src, extKey]
  );
  if (q2.rowCount > 0) return Number(q2.rows[0].patient_id);

  const q3 = await pool.query(
    `SELECT patient_id FROM ext_patient_map WHERE ext_source=$1 AND ext_key=$2`,
    [src, extKey]
  );
  if (q3.rowCount > 0) return Number(q3.rows[0].patient_id);

  throw new Error("failed to resolve patient_id");
}

// 未処理を取り出しつつ processed_at を埋める
async function takeBatch(limit = 10) {
  const sql = `
    WITH picked AS (
      SELECT id
        FROM webhook_receipts
       WHERE processed_at IS NULL
       ORDER BY received_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
    )
    UPDATE webhook_receipts wr
       SET processed_at = now()
      FROM picked
     WHERE wr.id = picked.id
  RETURNING wr.id, wr.event, wr.payload, wr.idempotency_key;
  `;
  const r = await pool.query(sql, [limit]);
  return r.rows as Array<{
    id: number;
    event: string;
    payload: any;
    idempotency_key: string;
  }>;
}

function isBenignConflict(e: any) {
  // 23505: unique_violation, 23P01: exclusion_violation（tstzrange重なりなど）
  return e && typeof e === "object" && (e.code === "23505" || e.code === "23P01");
}

async function materialize(row: {
  id: number;
  event: string;
  payload: any;
  idempotency_key: string;
}) {
  const ev = row.event;
  const p = row.payload || {};
  const extPatientKey = String(p?.patient?.id || "");
  const startAt = String(p?.slot?.start || "");
  const endAt = p?.slot?.end ? String(p.slot.end) : null;
  const facilityId = Number(p?.slot?.facility_id ?? 0);

  if (!extPatientKey || !startAt) {
    console.warn(`[materialize] skip id=${row.id} (missing fields)`);
    return;
  }

  const tenantId = Number(process.env.OKAPON_DEFAULT_TENANT_ID || 1);
  const practitionerId = Number(process.env.OKAPON_DEFAULT_PRACTITIONER_ID || 1);
  const patientId = await getOrCreatePatientId(extPatientKey);

  if (ev === "appointment.created") {
    // 在宅判定に通った場合のみ作成
    if (!isHomecareFacility(facilityId)) {
      console.log(`[materialize] skip non-homecare facility=${facilityId}`);
      return;
    }
    try {
      await pool.query(
        `INSERT INTO home_visit_occurrences
           (tenant_id, patient_id, practitioner_id, scheduled, status, start_at, end_at)
         VALUES ($1,$2,$3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), 'planned', $4::timestamptz, $5::timestamptz)`,
        [tenantId, patientId, practitionerId, startAt, endAt]
      );
      console.log(
        `[materialize] created HVO tenant=${tenantId} patient=${patientId} prac=${practitionerId} @${startAt}`
      );
    } catch (e: any) {
      if (isBenignConflict(e)) {
        console.log(`[materialize] duplicate/overlap ignored @${startAt} (code=${e.code})`);
        return;
      }
      throw e;
    }
  } else if (ev === "appointment.canceled") {
    // facility の有無に依存せずキャンセルを反映（取りこぼし防止）
    const r = await pool.query(
      `UPDATE home_visit_occurrences
          SET status='canceled'
        WHERE tenant_id=$1 AND patient_id=$2 AND start_at=$3::timestamptz`,
      [tenantId, patientId, startAt]
    );
    console.log(
      `[materialize] canceled HVO affected=${r.rowCount} patient=${patientId} @${startAt}`
    );
  } else {
    console.log(`[materialize] ignore event=${ev}`);
  }
}

async function main() {
  console.log("[materializer] start");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const batch = await takeBatch(10);
      if (batch.length === 0) {
        process.stdout.write(".");
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      console.log(`\n[materializer] picked ${batch.length}`);
      for (const row of batch) {
        try {
          await materialize(row);
        } catch (e: any) {
          console.error("[materialize] failed:", e?.message || e);
        }
      }
    } catch (e: any) {
      console.error("[materializer] loop error:", e?.message || e);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
