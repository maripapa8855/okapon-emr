import express from "express";
const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
const port = Number(process.env.PORT || 5001);
app.listen(port, () => console.log("PING listening on :" + port));