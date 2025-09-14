import express from "express";
import { Pool } from "pg";

const router = express.Router();
const hasDb = !!process.env.DATABASE_URL;
const pool = hasDb ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;

function bad(res: express.Response, code:number, msg:string) { return res.status(code).json({ message: msg }); }

// 今日の外来
router.get("/encounters/today", async (_req, res) => {
  if (!pool) return res.json({ items: [] });
  const include = String(_req.query.include || "");
  const statuses = include === "canceled"
    ? ["planned","in_progress","completed","canceled"]
    : ["planned","in_progress"];
  try {
    const r = await pool.query(
      `SELECT id, patient_id, start_at, end_at, status, appointment_key
         FROM encounters
        WHERE start_at::date = CURRENT_DATE
          AND status = ANY($1)
        ORDER BY start_at`,
      [statuses]
    );
    res.json({ items: r.rows });
  } catch (e:any) {
    console.error("[clinic today] failed:", e?.message || e);
    bad(res, 500, "unavailable");
  }
});

// 詳細
router.get("/encounters/:id", async (req, res) => {
  const id = Number(req.params.id); if (!id) return bad(res, 400, "invalid id");
  if (!pool) return bad(res, 503, "unavailable");
  const r = await pool.query(
    `SELECT id, patient_id, start_at, end_at, status, appointment_key
       FROM encounters WHERE id=$1`, [id]
  );
  if (r.rowCount===0) return bad(res, 404, "not found");
  res.json(r.rows[0]);
});

// 受付開始（冪等キー）
router.post("/encounters/:id/start", async (req, res) => {
  const id = Number(req.params.id); if (!id) return bad(res, 400, "invalid id");
  if (!pool) return bad(res, 503, "unavailable");
  const idem = String(req.get("Idempotency-Key") || req.body?.idempotency_key || "");
  const at   = String(req.body?.at || ""); if (!at) return bad(res, 400, "at is required");
  const note = typeof req.body?.note === "string" ? req.body.note : null;

  try {
    if (idem) {
      const x = await pool.query(`SELECT 1 FROM encounter_touches WHERE idempotency_key=$1`, [idem]);
      if (x.rowCount>0) {
        await pool.query(`UPDATE encounters SET status='in_progress' WHERE id=$1 AND status IN ('planned','in_progress')`, [id]);
        return res.json({ ok:true, duplicate:true });
      }
    }
    await pool.query(
      `INSERT INTO encounter_touches (encounter_id, kind, at, note, idempotency_key)
       VALUES ($1,'start',$2::timestamptz,$3,NULLIF($4,''))`, [id, at, note, idem]
    );
    await pool.query(`UPDATE encounters SET status='in_progress' WHERE id=$1 AND status IN ('planned','in_progress')`, [id]);
    res.json({ ok:true, duplicate:false });
  } catch (e:any) {
    if (e?.code === "23505") {
      await pool.query(`UPDATE encounters SET status='in_progress' WHERE id=$1 AND status IN ('planned','in_progress')`, [id]);
      return res.json({ ok:true, duplicate:true });
    }
    console.error("[clinic start] failed:", e?.message || e);
    bad(res, 500, "failed to start");
  }
});

// 診療完了（冪等キー）
router.post("/encounters/:id/complete", async (req, res) => {
  const id = Number(req.params.id); if (!id) return bad(res, 400, "invalid id");
  if (!pool) return bad(res, 503, "unavailable");
  const idem = String(req.get("Idempotency-Key") || req.body?.idempotency_key || "");
  const at   = String(req.body?.at || ""); if (!at) return bad(res, 400, "at is required");
  const note = typeof req.body?.note === "string" ? req.body.note : null;

  try {
    if (idem) {
      const x = await pool.query(`SELECT 1 FROM encounter_touches WHERE idempotency_key=$1`, [idem]);
      if (x.rowCount>0) {
        await pool.query(`UPDATE encounters SET status='completed' WHERE id=$1 AND status IN ('in_progress','planned','completed')`, [id]);
        return res.json({ ok:true, duplicate:true });
      }
    }
    await pool.query(
      `INSERT INTO encounter_touches (encounter_id, kind, at, note, idempotency_key)
       VALUES ($1,'complete',$2::timestamptz,$3,NULLIF($4,''))`, [id, at, note, idem]
    );
    await pool.query(`UPDATE encounters SET status='completed' WHERE id=$1 AND status IN ('in_progress','planned','completed')`, [id]);
    res.json({ ok:true, duplicate:false });
  } catch (e:any) {
    if (e?.code === "23505") {
      await pool.query(`UPDATE encounters SET status='completed' WHERE id=$1 AND status IN ('in_progress','planned','completed')`, [id]);
      return res.json({ ok:true, duplicate:true });
    }
    console.error("[clinic complete] failed:", e?.message || e);
    bad(res, 500, "failed to complete");
  }
});

export default router;
