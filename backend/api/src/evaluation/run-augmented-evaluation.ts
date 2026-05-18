/**
 * ============================================================
 * Run Augmented Evaluation CLI — strict + relaxed 이중 평가 실행기
 * ============================================================
 *
 * 키워드 라우팅(strict)과 Semantic 라우팅(relaxed)을 함께 측정하여
 * Semantic Router 통합의 가치(uplift)를 정량적으로 보여준다.
 *
 * 사용법:
 *   npm run eval:augmented
 *   ts-node src/evaluation/run-augmented-evaluation.ts custom-dataset.json
 *
 * 환경변수:
 *   - OMK_SEMANTIC_ROUTER_ENABLED는 강제로 'true'로 설정됨 (CLI 단독 활성)
 *   - OMK_EMBEDDING_MODEL: 임베딩 모델 (기본 nomic-embed-text)
 *
 * 결과:
 *   - logs/augmented-evaluation-{timestamp}-{commit}.json
 *   - exit code: relaxedPassRate >= OMK_EVAL_AUGMENTED_THRESHOLD(기본 0.5)면 0
 *
 * @module evaluation/run-augmented-evaluation
 */
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import * as dotenv from 'dotenv';

// 1) .env 로드 (winston/config 의존성)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// 2) Semantic Router는 CLI 단독에서도 강제 활성
//    (반드시 dotenv.config 다음, 모듈 import 이전)
process.env.OMK_SEMANTIC_ROUTER_ENABLED = 'true';

import { loadGoldenDataset } from './dataset-loader';
import { runAugmentedEvaluation } from './semantic-augmented-evaluator';
import type { AugmentedSummary } from './semantic-augmented-evaluator';
import { getModelForRole } from '../config/model-roles';

const PASS_RATE_THRESHOLD = Number(process.env.OMK_EVAL_AUGMENTED_THRESHOLD ?? '0.5');

function getGitCommitHash(): string {
    try {
        return childProcess.execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        return 'unknown';
    }
}

async function main() {
    const customPath = process.argv[2];
    const dataset = loadGoldenDataset(customPath);

    console.log(`\n[Augmented Evaluation] 데이터셋: v${dataset.version}, 케이스 ${dataset.cases.length}개`);
    console.log(`[Augmented Evaluation] 임계값(relaxed): ${(PASS_RATE_THRESHOLD * 100).toFixed(0)}%\n`);

    // CLI 단독에서 semantic router init + 인덱스 빌드 대기
    // 서버 인스턴스의 singleton과는 별도 프로세스라 안전 (각 Node 프로세스가 독립)
    const { LLMClient } = await import('../llm');
    const { initSemanticRouter, isSemanticRouterReady, findSemanticCandidates } =
        await import('../agents/semantic-router-instance');

    const client = new LLMClient();
    initSemanticRouter(client);

    // 인덱스 빌드 폴링 (최대 60초, 100명 임베딩이 끝날 때까지)
    const startWait = Date.now();
    const TIMEOUT_MS = 60_000;
    while (!isSemanticRouterReady() && Date.now() - startWait < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 500));
    }
    if (!isSemanticRouterReady()) {
        console.error('❌ Semantic Router 인덱스 빌드 타임아웃 (60s)');
        process.exit(2);
    }
    console.log(`[Augmented Evaluation] Semantic 인덱스 준비 완료 (${Date.now() - startWait}ms)\n`);

    const summary = await runAugmentedEvaluation(dataset, findSemanticCandidates);
    printSummary(summary);
    saveSummaryToFile(summary);

    if (summary.relaxedPassRate < PASS_RATE_THRESHOLD) {
        console.error(
            `\n❌ 평가 실패: relaxedPassRate ${(summary.relaxedPassRate * 100).toFixed(1)}% < ` +
            `임계값 ${(PASS_RATE_THRESHOLD * 100).toFixed(0)}%`
        );
        process.exit(1);
    }
    console.log(`\n✅ Augmented 평가 성공`);
    process.exit(0);
}

function printSummary(summary: AugmentedSummary): void {
    console.log('─'.repeat(70));
    console.log(`총 케이스: ${summary.totalCases}`);
    console.log(`Strict (키워드 top-1)   : ${summary.strictPassCount} / ${summary.totalCases} (${(summary.strictPassRate * 100).toFixed(1)}%)`);
    console.log(`Relaxed (semantic top-3): ${summary.relaxedPassCount} / ${summary.totalCases} (${(summary.relaxedPassRate * 100).toFixed(1)}%)`);
    console.log(`Semantic Uplift          : ${summary.semanticUpliftCount}건 (${(summary.semanticUpliftRate * 100).toFixed(1)}%) ← Semantic Router 추가 가치`);
    console.log(`평균 케이스 소요         : ${summary.avgDurationMs}ms`);
    console.log('─'.repeat(70));

    const upliftCases = summary.results.filter((r) => r.semanticAddedValue);
    if (upliftCases.length > 0) {
        console.log('\n[Uplift 케이스 — semantic이 키워드 라우팅을 보완]');
        for (const c of upliftCases) {
            console.log(`  [${c.caseId}] kw=${c.keywordAgentId} / sem-top3=[${c.semanticTopAgentIds.join(',')}] / expected=[${c.expectedAgentIds.join(',')}]`);
        }
    }
}

function saveSummaryToFile(summary: AugmentedSummary): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logsDir = path.resolve(__dirname, '../../logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const commit = getGitCommitHash();
    const outputPath = path.join(logsDir, `augmented-evaluation-${timestamp}-${commit}.json`);
    const enriched = {
        meta: {
            gitCommit: commit,
            nodeVersion: process.version,
            generatedAt: new Date().toISOString(),
            embeddingModel: getModelForRole('embedding'),
        },
        ...summary,
    };
    fs.writeFileSync(outputPath, JSON.stringify(enriched, null, 2), 'utf-8');
    console.log(`\n결과 저장: ${outputPath}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Augmented 평가 실행 실패:', err);
        process.exit(2);
    });
}
