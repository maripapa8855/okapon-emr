import express from "express";
const router = express.Router();

// 疎通確認用
router.get("/_ping", (_req, res) => res.json({ ok: true, route: "homecare_ext", ts: new Date().toISOString() }));

const memIdem = new Set<string>();
const rows: any[] = [];
const MAX = 1000;

// ===== GET /api/homecare/visits/today =====
// きょうの planned を返す。?include=canceled で取消も含め可能。
router.get("/visits/today", async (req, res) => {
    const includeCanceled = String(req.query.include || "") === "canceled";
    const statuses = includeCanceled ? ["planned", "canceled"] : ["planned"];


    if (pool) {
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
        }
    }
    // メモリ・フォールバック（簡易）: いまは空配列
    return res.json({ items: [] });
});


// ===== GET /api/homecare/visits/:id =====
router.get("/visits/:id", async (req, res) => {
    const visitId = Number(req.params.id);
    if (!visitId) return res.status(400).json({ message: "invalid id" });
    if (pool) {
        try {
            const r = await pool.query(
                `SELECT id, patient_id, start_at, end_at, status
    FROM home_visit_occurrences
    WHERE id=$1`,
                [visitId]
            );
            if (r.rowCount === 0) return res.status(404).json({ message: "not found" });
            return res.json(r.rows[0]);
        } catch (e: any) {
            console.error("[homecare get visit] DB failed:", e?.message || e);
        }
    }
    return res.status(503).json({ message: "unavailable" });
});

// POST /api/homecare/visits/:id/checkin
router.post("/visits/:id/checkin", (req, res) => {
    try {
        const visitId = String(req.params.id || "");
        const { at, lat, lng, note } = req.body ?? {};
        let idem = String(req.get("Idempotency-Key") || "");
        // ヘッダが無い/空 → 決定的なキーを自動生成（visitId+at+丸めた座標+note長）
        if (!idem) {
            const latS = (lat ?? "").toString().slice(0, 8);
            const lngS = (lng ?? "").toString().slice(0, 9);
            idem = `auto:${visitId}:${at}:${latS}:${lngS}:${(note ?? "").length}`;
        }
        if (!visitId || !idem || !at) return res.status(400).json({ message: "visitId, at, Idempotency-Key は必須です" });

        const duplicate = memIdem.has(idem);
        if (!duplicate) {
            memIdem.add(idem);
            rows.unshift({
                id: rows.length + 1,
                visit_id: visitId, at, lat: lat ?? null, lng: lng ?? null, note: note ?? null,
                idempotency_key: idem, created_at: new Date().toISOString()
            });
            if (rows.length > MAX) rows.pop();
        }
        console.log("[checkin]", { visitId, idem, duplicate });
        return res.json({ ok: true, duplicate, mode: "memory" });
    } catch (e: any) {
        console.error("[checkin] unexpected error:", e?.message || e);
        return res.status(500).json({ message: "checkin error (memory)" });
    }
});

// GET /api/homecare/visits/:id/checkins （直近10件）
router.get("/visits/:id/checkins", (req, res) => {
    const visitId = String(req.params.id || "");
    res.json({ items: rows.filter(r => r.visit_id === visitId).slice(0, 10) });
});

export default router;