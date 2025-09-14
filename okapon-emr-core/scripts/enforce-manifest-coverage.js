import fs from "node:fs";
import { execSync } from "node:child_process";

const raw = fs.readFileSync("scripts/check-core-manifest.json", "utf8");
const mf = JSON.parse(raw.replace(/^\uFEFF/, ""));

const covered = new Set([
  ...(mf.required || []),
  ...[].concat(...(mf.requiredAny || [])),
  ...[].concat(...(mf.optionalAny || []))
]);

function getAddedFiles() {
  const cmds = [
    "git diff --cached --name-only --diff-filter=AR",
    "git diff --name-only origin/main...HEAD --diff-filter=AR",
    "git diff --name-only HEAD~1 --diff-filter=AR"
  ];
  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { stdio: ["ignore","pipe","ignore"] }).toString().trim();
      if (out) return out.split(/\r?\n/);
    } catch {}
  }
  return [];
}

const added = getAddedFiles()
  .filter(p => p.startsWith("src/") && (p.startsWith("src/routes/") || p.startsWith("src/workers/")))
  .filter(p => p.endsWith(".ts"));

const uncovered = added.filter(p => !covered.has(p));
if (uncovered.length) {
  console.error("✖ New critical files not listed in scripts/check-core-manifest.json:");
  for (const p of uncovered) console.error("  - " + p);
  console.error("→ マニフェストの required / requiredAny / optionalAny のいずれかに追記してください。");
  process.exit(1);
}
console.log("✔ manifest coverage: OK");
