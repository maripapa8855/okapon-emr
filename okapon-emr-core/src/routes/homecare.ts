import express from "express";
import { Pool } from "pg";

const router = express.Router();

// DB（なければ undefined でフォールバックレスポンス）
const hasDb = !!process.env.DATABASE_URL;
const pool = hasDb ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;

// ---- 共通: JSON helper
function bad(res: express.Response, code: number, msg: string) {
  return res.status(code).json({ message: msg });
}

// ===== GET /api/homecare/visits/today =====
// 本日分の planned/in_progress を返す（?include=canceled で取消含む）
router.get("/visits/today", async (_req, res) => {
  if (!pool) return res.json({ items: [] });
  const include = String(_req.query.include || "");
  const statuses = include === "canceled" ? ["planned", "in_progress", "canceled", "completed"] : ["planned", "in_progress"];
  try {
    const r = await pool.query(
      `SELECT id, patient_id, start_at, end_at, status
         FROM home_visit_occurrences
        WHERE start_at::date = CURRENT_DATE
          AND status = ANY($1)
        ORDER BY start_at`,
      [statuses]
    );
    return res.json({ items: r.rows });
  } catch (e: any) {
    console.error("[homecare today] DB failed:", e?.message || e);
    return bad(res, 500, "unavailable");
  }
});

// ===== GET /api/homecare/visits/:id =====
router.get("/visits/:id", async (req, res) => {
  const visitId = Number(req.params.id);
  if (!visitId) return bad(res, 400, "invalid id");
  if (!pool) return bad(res, 503, "unavailable");
  try {
    const r = await pool.query(
      `SELECT id, patient_id, start_at, end_at, status
         FROM home_visit_occurrences
        WHERE id=$1`,
      [visitId]
    );
    if (r.rowCount === 0) return bad(res, 404, "not found");
    return res.json(r.rows[0]);
  } catch (e: any) {
    console.error("[homecare get visit] DB failed:", e?.message || e);
    return bad(res, 500, "unavailable");
  }
});

// ===== POST /api/homecare/visits/:id/checkin =====
// 冪等: Idempotency-Key ヘッダ または body.idempotency_key
router.post("/visits/:id/checkin", async (req, res) => {
  const visitId = Number(req.params.id);
  if (!visitId) return bad(res, 400, "invalid id");
  if (!pool) return bad(res, 503, "unavailable");

  const idem = String(req.get("Idempotency-Key") || req.body?.idempotency_key || "");
  const at   = String(req.body?.at || "");
  const lat  = req.body?.lat ?? null;
  const lng  = req.body?.lng ?? null;
  const note = typeof req.body?.note === "string" ? req.body.note : null;

  if (!at) return bad(res, 400, "at is required (ISO8601)");

  try {
    // 既に存在するか？（冪等キー）
    if (idem) {
      const exist = await pool.query(
        `SELECT 1 FROM home_visit_checkins WHERE idempotency_key=$1`,
        [idem]
      );
      if (exist.rowCount > 0) {
        // ステータスだけ整合させて返す
        await pool.query(
          `UPDATE home_visit_occurrences SET status='in_progress' WHERE id=$1 AND status IN ('planned','in_progress')`,
          [visitId]
        );
        return res.json({ ok: true, duplicate: true });
      }
    }

    // 登録
    await pool.query(
      `INSERT INTO home_visit_checkins (visit_id, at, note, idempotency_key, lat, lng)
       VALUES ($1, $2::timestamptz, $3, NULLIF($4,''), $5, $6)`,
      [visitId, at, note, idem, lat, lng]
    );
    // ステータス遷移
    await pool.query(
      `UPDATE home_visit_occurrences SET status='in_progress'
         WHERE id=$1 AND status IN ('planned','in_progress')`,
      [visitId]
    );
    return res.json({ ok: true, duplicate: false });
  } catch (e: any) {
    // unique_violation（idempotency）なら duplicate 扱い
    if (e?.code === "23505") {
      await pool.query(
        `UPDATE home_visit_occurrences SET status='in_progress'
           WHERE id=$1 AND status IN ('planned','in_progress')`,
        [visitId]
      );
      return res.json({ ok: true, duplicate: true });
    }
    console.error("[homecare checkin] failed:", e?.message || e);
    return bad(res, 500, "failed to checkin");
  }
});

// ===== POST /api/homecare/visits/:id/checkout =====
// 冪等: Idempotency-Key ヘッダ または body.idempotency_key
router.post("/visits/:id/checkout", async (req, res) => {
  const visitId = Number(req.params.id);
  if (!visitId) return bad(res, 400, "invalid id");
  if (!pool) return bad(res, 503, "unavailable");

  const idem = String(req.get("Idempotency-Key") || req.body?.idempotency_key || "");
  const at   = String(req.body?.at || "");
  const note = typeof req.body?.note === "string" ? req.body.note : null;

  if (!at) return bad(res, 400, "at is required (ISO8601)");

  try {
    if (idem) {
      const exist = await pool.query(
        `SELECT 1 FROM home_visit_checkouts WHERE idempotency_key=$1`,
        [idem]
      );
      if (exist.rowCount > 0) {
        await pool.query(
          `UPDATE home_visit_occurrences SET status='completed'
             WHERE id=$1 AND status IN ('in_progress','completed')`,
          [visitId]
        );
        return res.json({ ok: true, duplicate: true });
      }
    }

    await pool.query(
      `INSERT INTO home_visit_checkouts (visit_id, at, note, idempotency_key)
       VALUES ($1, $2::timestamptz, $3, NULLIF($4,''))`,
      [visitId, at, note, idem]
    );
    await pool.query(
      `UPDATE home_visit_occurrences SET status='completed'
         WHERE id=$1 AND status IN ('in_progress','planned','completed')`,
      [visitId]
    );
    return res.json({ ok: true, duplicate: false });
  } catch (e: any) {
    if (e?.code === "23505") {
      // visit_id のユニーク制約 or idempotency 重複
      await pool.query(
        `UPDATE home_visit_occurrences SET status='completed'
           WHERE id=$1 AND status IN ('in_progress','planned','completed')`,
        [visitId]
      );
      return res.json({ ok: true, duplicate: true });
    }
    console.error("[homecare checkout] failed:", e?.message || e);
    return bad(res, 500, "failed to checkout");
  }
});

// ===== 履歴: GET /api/homecare/visits/:id/checkins =====
router.get("/visits/:id/checkins", async (req, res) => {
  const visitId = Number(req.params.id);
  if (!visitId) return bad(res, 400, "invalid id");
  if (!pool) return bad(res, 503, "unavailable");
  try {
    const r = await pool.query(
      `SELECT id, at, note, idempotency_key
         FROM home_visit_checkins
        WHERE visit_id=$1
        ORDER BY at DESC`,
      [visitId]
    );
    return res.json({ items: r.rows });
  } catch (e:any) {
    console.error("[homecare list checkins] failed:", e?.message || e);
    return bad(res, 500, "unavailable");
  }
});

// ===== 履歴: GET /api/homecare/visits/:id/checkout =====
router.get("/visits/:id/checkout", async (req, res) => {
  const visitId = Number(req.params.id);
  if (!visitId) return bad(res, 400, "invalid id");
  if (!pool) return bad(res, 503, "unavailable");
  try {
    const r = await pool.query(
      `SELECT id, at, note, idempotency_key
         FROM home_visit_checkouts
        WHERE visit_id=$1`,
      [visitId]
    );
    if (r.rowCount === 0) return res.json(null);
    return res.json(r.rows[0]);
  } catch (e:any) {
    console.error("[homecare get checkout] failed:", e?.message || e);
    return bad(res, 500, "unavailable");
  }
});

export default router;
