import express from "express";
import { Pool } from "pg";

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

// POST /api/homecare/visits/:id/checkin
router.post("/visits/:id/checkin", async (req, res) => {
  const visitId = String(req.params.id || "");
  const idem = String(req.get("Idempotency-Key") || "");
  const { at, lat, lng, note } = req.body ?? {};

  if (!visitId || !idem || !at) {
    return res.status(400).json({ message: "visitId, at, Idempotency-Key は必須です" });
  }

  try {
    const q = `
      INSERT INTO home_visit_checkins (visit_id, at, lat, lng, note, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id;
    `;
    const r = await pool.query(q, [visitId, at, lat ?? null, lng ?? null, note ?? null, idem]);
    const duplicate = r.rowCount === 0;
    return res.status(200).json({ ok: true, duplicate });
  } catch (e: any) {
    console.error("[/api/homecare/visits/:id/checkin] error:", e?.message || e);
    return res.status(500).json({ message: "checkin error" });
  }
});

export default router;
