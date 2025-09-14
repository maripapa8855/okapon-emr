import fs from "node:fs";

const raw = fs.readFileSync("scripts/check-core-manifest.json", "utf8");
const mf = JSON.parse(raw.replace(/^\uFEFF/, ""));

const exists = (p) => fs.existsSync(p);
let ok = true;

// required（必ず必要）
for (const f of mf.required || []) {
  if (!exists(f)) { console.error(`✖ missing file: ${f}`); ok = false; }
}
// requiredAny（どれか1つ）
for (const group of mf.requiredAny || []) {
  if (!group.some(exists)) {
    console.error(`✖ missing any of: ${group.join(" | ")}`);
    ok = false;
  }
}

// package.json の scripts/依存
const pj = JSON.parse(fs.readFileSync("package.json","utf8"));
for (const s of mf.scripts || []) {
  if (!pj.scripts?.[s]) { console.error(`✖ missing script: ${s} in package.json`); ok = false; }
}
for (const d of mf.dependencies || []) {
  if (!pj.dependencies?.[d]) { console.error(`✖ missing dependency: ${d}`); ok = false; }
}
for (const d of mf.devDependencies || []) {
  if (!pj.devDependencies?.[d]) { console.error(`✖ missing devDependency: ${d}`); ok = false; }
}

if (ok) { console.log("✔ core bundle check: OK"); process.exit(0); }
process.exit(1);
