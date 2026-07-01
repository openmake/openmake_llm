#!/usr/bin/env node
/**
 * i18n 키 정합 가드 — messages/ko.json(원본) 대비 나머지 locale 파일의
 * 키 세트가 완전히 일치하는지 검사한다. 누락/잉여 키가 있으면 exit 1.
 * 사용: npm run check:i18n (apps/web)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MESSAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const SOURCE = "ko.json";

function flattenKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const files = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
const sourceKeys = new Set(
  flattenKeys(JSON.parse(readFileSync(join(MESSAGES_DIR, SOURCE), "utf8"))),
);

let failed = false;
for (const file of files) {
  if (file === SOURCE) continue;
  const keys = new Set(flattenKeys(JSON.parse(readFileSync(join(MESSAGES_DIR, file), "utf8"))));
  const missing = [...sourceKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !sourceKeys.has(k));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`✗ ${file}`);
    for (const k of missing) console.error(`    missing: ${k}`);
    for (const k of extra) console.error(`    extra:   ${k}`);
  } else {
    console.log(`✓ ${file} (${keys.size} keys)`);
  }
}

if (failed) {
  console.error(`\ni18n key mismatch — ${SOURCE} 기준으로 모든 locale 파일의 키를 맞춰주세요.`);
  process.exit(1);
}
console.log(`i18n keys OK — ${files.length} locales, ${sourceKeys.size} keys each.`);
