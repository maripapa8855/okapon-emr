import express from "express";
import { Pool } from "pg";
const router = express.Router();

// Poolを安全に初期化（パスワードが空ならDB無効）
const conn = process.env.DATABASE_URL || "";
let pool: Pool | null = null;
try {
  if (conn) {
    const u = new URL(conn);
    if (u.password) pool = new Pool({ connectionString: conn });
    else console.warn("[DB] password missing → memory mode");
  }
} catch { console.warn("[DB] invalid DATABASE_URL → memory mode"); }

// 冪等（メモリでも判定しておく）
const memIdem = new Set<string>();
const MEM_LIMIT = 5000;

router.post("/appointments", async (req, res) => {
  const payload = req.body ?? {};
  const event = String(payload.event || "");
  const idem  = String(payload.idempotency_key || req.get("Idempotency-Key") || "");
  if (!event || !idem) return res.status(400).json({ message: "event と idempotency_key は必須です" });
  if (!/^appointment\.(created|canceled)$/.test(event)) return res.status(422).json({ message: "未対応の event です" });

  const seen = memIdem.has(idem);
  if (!seen) { memIdem.add(idem); if (memIdem.size > MEM_LIMIT) memIdem.clear(); }
  if (!pool) return res.json({ ok: true, duplicate: seen, mode: "memory" });

  try {
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    const r = await pool.query(
      `INSERT INTO webhook_receipts(source,event,idempotency_key,payload,received_at,client_ip)
       VALUES ($1,$2,$3,$4,now(),$5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      ["reservations", event, idem, payload, clientIp]
    );
    return res.json({ ok: true, duplicate: r.rowCount === 0, mode: "postgres" });
  } catch (e:any) {
    console.error("[/integrations/appointments] DB failed:", e?.message || e);
    return res.json({ ok: true, duplicate: seen, mode: "memory-fallback", error: "db_insert_failed" });
  }
});

export default router;
