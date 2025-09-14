import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "src", "app");

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.map(p => p.replace(/\\/g, "/")); // normalize
}

function checkDomain(domain, group) {
  if (!fs.existsSync(APP_DIR)) return true; // no app dir yet
  const canonicalDir = path.join(APP_DIR, group, domain);
  const hasCanonical = fs.existsSync(canonicalDir);

  const files = walk(APP_DIR);
  const directPrefix   = `src/app/${domain}/`;
  const allowedPrefix  = `src/app/${group}/${domain}/`;

  // 直下に置いてしまったものを抽出
  let offenders = files.filter(p => p.startsWith(directPrefix));

  // 正規のグループがある場合は、正しい場所は許容し、それ以外をNGにする
  if (hasCanonical) offenders = offenders.filter(p => !p.startsWith(allowedPrefix));

  if (offenders.length) {
    console.error(`✖ Route placement error for "${domain}". Place files under: ${allowedPrefix}`);
    for (const f of offenders) console.error(`  - ${f}`);
    return false;
  }
  return true;
}

// 既存グループは必須チェック、(clinic) はあればチェック
const targets = [
  { domain: "homecare",  group: "(homecare)",  required: true  },
  { domain: "inpatient", group: "(inpatient)", required: true  },
  { domain: "clinic",    group: "(clinic)",    required: false },
];

let ok = true;
for (const t of targets) {
  const canonical = path.join(APP_DIR, t.group, t.domain);
  if (!t.required && !fs.existsSync(canonical)) continue; // まだ無ければスキップ
  ok &&= checkDomain(t.domain, t.group);
}

process.exit(ok ? 0 : 1);
