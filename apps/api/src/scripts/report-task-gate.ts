/**
 * ============================================================
 * 작업 게이트 검토 보고 — 셰도우 기록의 분포와 표본
 * ============================================================
 *
 * chat_task_gate_log(185)의 판정 확률 분포, 기준값 후보별 "제안될 비율", 판정 지연,
 * 그리고 사람이 읽고 맞는지 볼 표본(확률 상위·경계 구간)을 출력한다. 정답 표지는 없다 — 기준값과
 * 질문 문장은 이 출력을 보고 정한다. 실행 경로 무변경 — 분석 전용.
 *
 * 실행: npx ts-node apps/api/src/scripts/report-task-gate.ts [일수=7] [표본수=30]
 *
 * @module scripts/report-task-gate
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true } as dotenv.DotenvConfigOptions);

import type { TaskGateSample, TaskGateSummary } from '../data/repositories/chat-task-gate-log-repository';

const DEFAULT_DAYS = 7;
const DEFAULT_SAMPLES = 30;
/** 응답에 실을 기준값의 후보 — 각각에서 몇 건이 제안됐을지 본다 */
const THRESHOLD_CANDIDATES = [0.5, 0.7, 0.9];
/** 판정이 갈리는 경계 구간 — 질문 문장을 다듬을 때 먼저 읽는다 */
const BORDER_RANGE: [number, number] = [0.3, 0.7];

const pct = (part: number, whole: number): string => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0.0%');
const ms = (v: number | null): string => (v === null ? '-' : `${Math.round(v)}ms`);
const sampleLine = (s: TaskGateSample): string => `  ${s.pTrue.toFixed(3)}  ${s.question === null ? '(본문 없음)' : s.question.replace(/\s+/g, ' ').trim()}`;

/** PURE: 보고 문자열을 만든다 */
export function formatTaskGateReport(data: {
    days: number;
    summary: TaskGateSummary;
    histogram: Array<{ bucket: number; count: number }>;
    top: TaskGateSample[];
    border: TaskGateSample[];
}): string {
    const { summary: s, histogram } = data;
    const judged = histogram.reduce((sum, h) => sum + h.count, 0);
    const lines: string[] = [
        `작업 게이트 검토 — 최근 ${data.days}일`,
        `전체 ${s.total}건 (규칙 ${s.rule} · 어댑터 ${s.jev} · 판정 실패 ${s.failed} = ${pct(s.failed, s.jev)})`,
        `판정 지연 p50 ${ms(s.p50Ms)} · p95 ${ms(s.p95Ms)}`,
        '',
        '확률 분포(어댑터 판정)',
    ];
    for (let b = 0; b < 10; b += 1) {
        const count = histogram.find((h) => h.bucket === b)?.count ?? 0;
        lines.push(`  ${(b / 10).toFixed(1)}~${((b + 1) / 10).toFixed(1)}  ${count}`);
    }
    lines.push('', '기준값 후보별 제안될 건수');
    for (const t of THRESHOLD_CANDIDATES) {
        const over = histogram.filter((h) => h.bucket >= Math.round(t * 10)).reduce((sum, h) => sum + h.count, 0);
        lines.push(`  기준 ${t} → ${over}건 (${pct(over, judged)})`);
    }
    lines.push('', `확률 상위 표본 ${data.top.length}건`, ...data.top.map(sampleLine));
    lines.push('', `경계 구간(${BORDER_RANGE[0]}~${BORDER_RANGE[1]}) 표본 ${data.border.length}건`, ...data.border.map(sampleLine));
    return lines.join('\n');
}

async function main(): Promise<void> {
    const days = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : DEFAULT_DAYS;
    const limit = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : DEFAULT_SAMPLES;
    // DB 모듈은 dotenv 뒤에 불러야 한다(설정 검증이 import 시점에 돈다) — 그래서 여기서 불러온다.
    const { getPool, closeDatabase } = await import('../data/models/unified-database');
    const { ChatTaskGateLogRepository } = await import('../data/repositories/chat-task-gate-log-repository');
    const repo = new ChatTaskGateLogRepository(getPool());
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
        const [summary, histogram, top, border] = await Promise.all([
            repo.summary(sinceIso),
            repo.histogram(sinceIso),
            repo.samples(sinceIso, BORDER_RANGE[1], 1, limit),
            repo.samples(sinceIso, BORDER_RANGE[0], BORDER_RANGE[1], limit),
        ]);
        console.log(formatTaskGateReport({ days, summary, histogram, top, border }));
    } finally {
        await closeDatabase();
    }
}

if (require.main === module) {
    main().catch((e) => {
        console.error(e instanceof Error ? e.message : e);
        process.exitCode = 1;
    });
}
