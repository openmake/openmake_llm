#!/usr/bin/env node
/**
 * i18n 키 정합 가드 — messages/ko.json(원본) 대비 나머지 locale 파일의
 * 키 세트가 완전히 일치하는지 검사한다. 누락/잉여 키가 있으면 exit 1.
 *
 * 문구 형식도 본다(2026-10-03): 화면에서 터지기 전에 잡는다.
 *   - ICU 문법으로 파싱되지 않는 문구 — `{{param}}` 을 그대로 쓰면 MALFORMED_ARGUMENT
 *   - 작은따옴표로 감싼 변수 `'{name}'` — ICU 에서 작은따옴표는 이스케이프라 변수가 치환되지 않고
 *     `{name}` 이 글자 그대로 나온다. 따옴표를 보이려면 `''{name}''`, 중괄호를 글자로 쓰려면 아래 목록에 등록.
 * 사용: npm run check:i18n (apps/web)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";

/** 중괄호를 글자 그대로 보여 주려고 일부러 이스케이프한 문구 */
const LITERAL_BRACE_KEYS = new Set(["marketplacePublish.secretNote", "agentTasks.templates.goalPlaceholder"]);
const QUOTED_VARIABLE = /(^|[^'])'\{[a-zA-Z_]+\}'(?!')/;

function flattenEntries(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flattenEntries(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
  );
}

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
  const locale = file.replace(/\.json$/, "");
  for (const [key, value] of flattenEntries(JSON.parse(readFileSync(join(MESSAGES_DIR, file), "utf8")))) {
    if (typeof value !== "string") continue;
    try {
      new IntlMessageFormat(value, locale);
    } catch (e) {
      failed = true;
      console.error(`✗ ${file} ${key}: ICU 파싱 실패 — ${e instanceof Error ? e.message : e}`);
    }
    if (!LITERAL_BRACE_KEYS.has(key) && QUOTED_VARIABLE.test(value)) {
      failed = true;
      console.error(`✗ ${file} ${key}: 작은따옴표로 감싼 변수는 치환되지 않습니다 — ''{…}'' 로 쓰세요`);
    }
  }
}
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
  console.error(`\ni18n 검사 실패 — 키는 ${SOURCE} 기준으로 맞추고, 문구 형식 오류는 위 안내대로 고쳐주세요.`);
  process.exit(1);
}
console.log(`i18n keys OK — ${files.length} locales, ${sourceKeys.size} keys each.`);
