import { Router } from "express";
import { q } from "../lib/db.js";
export const inpatientRouter = Router();


// ADT: 入院起票
inpatientRouter.post("/adt/admissions", async (req, res) => {
const { patient_id, admit_datetime, planned_flag } = req.body;
const r = await q(
`INSERT INTO admissions (tenant_id, patient_id, admit_datetime, planned_flag)
VALUES ($1,$2,$3,$4)
RETURNING id`,
[1, patient_id, admit_datetime, planned_flag ?? false]
);
res.status(201).json({ id: r.rows[0].id });
});


// ベッドボード（病棟別サマリ）
inpatientRouter.get("/wards/board", async (_req, res) => {
const r = await q(`
SELECT w.id AS ward_id, w.name AS ward_name,
COUNT(b.id) FILTER (WHERE b.is_active) AS beds_total,
COUNT(ba.id) FILTER (WHERE ba.end IS NULL) AS beds_occupied
FROM wards w
LEFT JOIN rooms r ON r.ward_id = w.id
LEFT JOIN beds b ON b.room_id = r.id AND b.is_active
LEFT JOIN bed_assignments ba ON ba.bed_id = b.id AND ba.end IS NULL
GROUP BY w.id, w.name
ORDER BY w.code`);
res.json(r.rows);
});
