#!/usr/bin/env node
/**
 * 부하 receipt 비교(설계 D6).
 *   node scripts/bench/compare.mjs --baseline <file> --current <file> [--out <md>]
 * exit: 0 통과 · 1 악화 · 2 무효(설정 다름·재시작·필드 없음·파일·인자 오류)
 */
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { compareReceipts, exitCodeForVerdict, renderComparison } from './lib.mjs';

function fail(message) {
    console.error(`[bench:compare] ${message}`);
    process.exit(2);
}

let values;
try {
    ({ values } = parseArgs({
        options: { baseline: { type: 'string' }, current: { type: 'string' }, out: { type: 'string' } },
        strict: true,
    }));
} catch (e) {
    fail(e.message);
}
if (!values.baseline || !values.current) fail('--baseline 과 --current 가 필요하다');

let baseline;
let current;
try {
    baseline = JSON.parse(readFileSync(values.baseline, 'utf8'));
    current = JSON.parse(readFileSync(values.current, 'utf8'));
} catch (e) {
    fail(`receipt 읽기 실패: ${e.message}`);
}

const result = compareReceipts(baseline, current);
const md = renderComparison(result, { baseline: values.baseline, current: values.current });
process.stdout.write(md);
if (values.out) {
    mkdirSync(dirname(values.out), { recursive: true });
    writeFileSync(values.out, md);
}
process.exit(exitCodeForVerdict(result.verdict));
