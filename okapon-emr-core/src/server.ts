import "dotenv/config";
import express from "express";
import cors from "cors";

// ルータ
import * as inpatient from "./routes/inpatient.js";   // named/default どちらでも動くように
import integrations from "./routes/integrations.js";
import homecareExt from "./routes/homecare_ext.js";
import clinicExt from "./routes/clinic_ext.js";       // ある場合だけ有効化

const app = express();
app.set("trust proxy", 1);

// ===== JSON & エラーハンドリング =====
app.use(express.json({ limit: "1mb" }));
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.type === "entity.too.large" || err instanceof SyntaxError) {
    return res.status(400).json({ message: "Invalid JSON" });
  }
  next(err);
});

// ===== CORS =====
const origins = (process.env.OKAPON_EMR_CORS_ORIGINS || "").split(/[\s,]+/).filter(Boolean);
const allowNgrok = String(process.env.OKAPON_EMR_ALLOW_NGROK_WILDCARD || "").toLowerCase() === "true";
const allowCfTunnel = String(process.env.OKAPON_EMR_ALLOW_CF_TUNNEL_WILDCARD || "").toLowerCase() === "true";
function isAllowed(origin?: string | null) {
  if (!origin) return true; // curl等
  if (origins.includes(origin)) return true;
  if (allowNgrok && /^https:\/\/([^.]+)\.(ngrok-free\.app|ngrok\.io)$/.test(origin)) return true;
  if (allowCfTunnel && /^https:\/\/([^.]+)\.(cfargotunnel\.com|trycloudflare\.com)$/.test(origin)) return true;
  return false;
}
app.use(cors({
  origin: (origin, cb) => cb(null, isAllowed(origin)),
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","Idempotency-Key"],
  maxAge: 86400
}));
app.options("*", cors());

// ===== Health =====
const version = process.env.OKAPON_EMR_VERSION || "dev";
app.get("/health", (_req, res) => res.json({ status: "ok", version, ts: new Date().toISOString() }));
app.get("/healthz", (_req, res) => res.json({ ok: true, version, ts: new Date().toISOString() }));

// ===== Feature-gated Routes =====
if (process.env.OKAPON_EMR_FEATURE_INPATIENT === "true") {
  const inpatientRouter: any = (inpatient as any).inpatientRouter || (inpatient as any).default;
  if (inpatientRouter) app.use("/api/inpatient", inpatientRouter);
}

if (process.env.OKAPON_EMR_FEATURE_HOMECARE === "true") {
  // 既定は拡張版のみをマウント（従来の homecareRouter は使わない）
  app.use("/api/homecare", homecareExt);
}

if (process.env.OKAPON_EMR_FEATURE_CLINIC === "true") {
  app.use("/api/clinic", clinicExt);
}

// 予約システム連携（冪等保存）
app.use("/integrations", integrations);

// ===== 404 / Error =====
app.use((_req, res) => res.status(404).json({ message: "Not Found" }));
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const status = Number(err?.status || 500);
  res.status(status).json({ message: err?.message || "Internal Server Error" });
});

// ===== Listen =====
const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`OkaPON EMR core listening on :${port}`));
