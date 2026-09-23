/**
 * ============================================================
 * K08 Knowledge Space 평가 러너 (CLI)
 * ============================================================
 *
 * 사용법:
 *   TEST_DATABASE_URL=<K01> ts-node .../run-knowledge-evaluation.ts                 # 검색 수준 평가(실 임베딩)
 *   TEST_DATABASE_URL=<K01> ts-node .../run-knowledge-evaluation.ts --real-llm       # + 실제 채팅 모델(순차)
 *   ... --real-llm --llm-subset 12                                                    # answerable/unanswerable 카테고리별 상한
 *   ... --out /tmp/k08.json                                                           # 리포트 경로
 *
 * 대상 DB 는 **K01 복제본뿐**이다(포트 5432=운영이면 실행 거부). 만든 합성 데이터는 끝에 전부 지운다.
 * 임계값·게이트는 eval-profile.json 에서만 온다(코드 리터럴 금지). blocking 게이트 실패 시 exit 1.
 *
 * @module addons/knowledge-runtime/evaluation/run-knowledge-evaluation
 */
import * as os from 'node:os';
import * as path from 'node:path';

// ── env: 루트 .env 로드 후 DATABASE_URL 을 K01 로 강제(운영 5432 차단) ──
require('dotenv').config({ path: path.resolve(__dirname, '../../../../../../.env') });

import { resetConfig } from '../../../config/env';
import type { EvalProfile, EvalDataset } from './types';
import { buildAndReport } from './run-support';

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag: string): boolean {
    return process.argv.includes(flag);
}

/** K01 전용 가드 — URL 필수 + 포트 5432(운영) 거부. 성공 시 DATABASE_URL 을 그 값으로 고정한다. */
function resolveTargetDbUrl(): string {
    const url = process.env.OMK_EVAL_KNOWLEDGE_DB_URL || process.env.TEST_DATABASE_URL;
    if (!url) {
        throw new Error('K01 복제본 DB URL 이 필요합니다 — OMK_EVAL_KNOWLEDGE_DB_URL 또는 TEST_DATABASE_URL 을 설정하세요.');
    }
    let port: string;
    try { port = new URL(url).port || '5432'; } catch { throw new Error('DB URL 형식이 올바르지 않습니다.'); }
    if (port === '5432') {
        throw new Error('거부: DB URL 이 포트 5432(운영)를 가리킵니다. 평가는 K01 복제본에서만 실행합니다.');
    }
    process.env.DATABASE_URL = url;
    resetConfig(); // 혹시 캐시된 config 가 있으면 K01 로 다시 로드
    return url;
}

async function main(): Promise<void> {
    const dbUrl = resolveTargetDbUrl();
    const withLlm = hasFlag('--real-llm');
    const llmSubset = Number(argValue('--llm-subset') ?? '0') || 0;
    const outPath = argValue('--out') || path.join(os.tmpdir(), `k08-knowledge-eval-${Date.now()}.json`);

    // env 고정 후에 프로필·데이터셋·모듈 로드(이 모듈들이 getPool 을 lazy 로 부른다)
    const profile = require('./eval-profile.json') as EvalProfile;
    const dataset = require('./dataset.json') as EvalDataset;

    const exitCode = await buildAndReport({ dbUrl, withLlm, llmSubset, outPath, profile, dataset });
    process.exit(exitCode);
}

main().catch((err) => {
    process.stderr.write(`\n❌ K08 평가 실패: ${err instanceof Error ? err.stack || err.message : String(err)}\n`);
    process.exit(1);
});
