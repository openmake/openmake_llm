/**
 * 주간 게이트 판정 리포트 — measure-first 게이트의 판정 근거 스냅샷 (무-LLM 결정적 렌더).
 *
 * plan: docs/proposals/2026-08-22-quality-flywheel-gate-observability-plan.md Stage 2.
 * 대상 게이트 3종은 Stage 1 집계(repository)를 그대로 재사용한다:
 *   ① Execution Graph 증분 — agent_tasks/agent_task_steps (retry·hitl_degrade·plan 귀속)
 *   ② 오케스트레이션 자동 배정 — orchestration_dispatch_decisions(086)
 *   ③ tail 라우팅 셰도우 — routing_shadow_decisions(061, 적재 중단 감지 포함)
 * agent-resolver 게이트는 winston 로그 기반 별도 스크립트(scripts/daily-routing-report.sh)가
 * 담당하므로 여기 포함하지 않는다.
 *
 * 노출 경로: admin push 알림 + admin 전용 라우트(GET /api/metrics/routing/report).
 * 예약 리포트의 공개 정적 게시(schedule-publish)를 재사용하지 않는 이유 — 그 경로는 인증
 * 없이 서빙되는데 이 리포트는 운영 지표다 (GATE_REPORT 설정 주석 참고).
 *
 * 멱등성: 스냅샷 파일(<DIR>/<YYYY-MM-DD>.html) 존재가 마커 — 재시작·tick 중복에 안전.
 *
 * @module monitoring/gate-report
 */
import { promises as fs } from 'fs';
import path from 'path';
import { GATE_REPORT } from '../config/runtime-limits';
import { REPORT_TEMPLATES_DIR } from '../config/report-templates';
import { createLogger } from '../utils/logger';

const logger = createLogger('GateReport');

/** ISO 요일 매핑 — Intl 'en-US' short weekday 기준 (1=월 ~ 7=일) */
const WEEKDAY_INDEX: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

/** 리포트 기준 TZ 의 날짜 문자열(YYYY-MM-DD) — 서버가 UTC 여도 날짜가 밀리지 않게 */
export function gateReportDateStr(now: Date, tz: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
}

/** 리포트 기준 TZ 의 ISO 요일 (1=월 ~ 7=일) */
export function gateReportWeekday(now: Date, tz: string): number {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
    return WEEKDAY_INDEX[name] ?? 0;
}

/** HTML escape — 리포트에 들어가는 모든 동적 값에 적용 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 게이트별 판정 입력 — repository 집계를 순수 판정 로직에 넘기기 위한 평탄화 형태 */
export interface GateReportInput {
    workflow: {
        totalTasks: number;
        retryTasks: number;
        hitlDegradeTasks: number;
        planCoverage: number;
        completedTasks: number;
        unjudgedRate: number;
        goalIncompleteTasks: number;
    };
    orchestration: {
        totalTurns: number;
        exposedTurns: number;
        calledTurns: number;
        successTurns: number;
    };
    tailShadow: {
        totalDecisions: number;
        tailDecisions: number;
        labeledDecisions: number;
        lastDecisionAt: string | null;
    };
}

export interface GateVerdict {
    gate: string;
    sample: number;
    /** 표시용 뱃지 톤 — ok(판정 가능)/warn(표본 부족)/danger(적재 중단) */
    tone: 'ok' | 'warn' | 'danger';
    status: string;
    note: string;
}

/**
 * 게이트별 판정 힌트 — 결정적 규칙만 사용한다(LLM 없음).
 * "판정" 자체(채택/반려)는 사람 몫이고, 여기서는 표본 충분성·적재 중단만 기계 판정한다.
 */
export function buildGateVerdicts(input: GateReportInput, minSample: number): GateVerdict[] {
    const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
    const sampleStatus = (sample: number): Pick<GateVerdict, 'tone' | 'status'> =>
        sample >= minSample
            ? { tone: 'ok', status: '판정 가능' }
            : { tone: 'warn', status: `표본 부족 (<${minSample}) — 계속 관측` };

    const wf = input.workflow;
    const orch = input.orchestration;
    const tail = input.tailShadow;

    const verdicts: GateVerdict[] = [
        {
            gate: 'Execution Graph 증분 (DAG 게이트)',
            sample: wf.totalTasks,
            ...sampleStatus(wf.totalTasks),
            note: `turn retry ${wf.retryTasks}건 · HITL 강등 ${wf.hitlDegradeTasks}건 · plan 귀속 ${pct(wf.planCoverage)} · 완료 무판정 ${pct(wf.unjudgedRate)} · goal_incomplete ${wf.goalIncompleteTasks}건`,
        },
        {
            gate: '오케스트레이션 자동 배정 (활성화 기준)',
            sample: orch.exposedTurns,
            ...sampleStatus(orch.exposedTurns),
            note: `노출 ${orch.exposedTurns}턴 → 호출 ${orch.calledTurns}턴 → 성공 ${orch.successTurns}턴 (전체 ${orch.totalTurns}턴)`,
        },
    ];

    if (tail.totalDecisions === 0) {
        verdicts.push({
            gate: 'Tail 라우팅 Stage 2 (061 셰도우)',
            sample: 0,
            tone: 'danger',
            status: '적재 중단 — 게이트 판정 불가',
            note: `기간 내 셰도우 결정 0건. 마지막 적재 ${tail.lastDecisionAt ?? '없음'} — TAIL_ROUTING_SHADOW_ENABLED 확인 필요`,
        });
    } else {
        verdicts.push({
            gate: 'Tail 라우팅 Stage 2 (061 셰도우)',
            sample: tail.totalDecisions,
            ...sampleStatus(tail.totalDecisions),
            note: `tail ${tail.tailDecisions}/${tail.totalDecisions}건 · 캘리브레이션 라벨 ${tail.labeledDecisions}건`,
        });
    }
    return verdicts;
}

/** 판정 카드 HTML — 값은 전부 escape */
function renderVerdictsHtml(verdicts: GateVerdict[]): string {
    return verdicts
        .map((v) => [
            '<div class="card">',
            `<h2>${escapeHtml(v.gate)}<span class="badge ${v.tone}">${escapeHtml(v.status)}</span></h2>`,
            `<p class="note">표본 ${v.sample.toLocaleString('ko-KR')}건 — ${escapeHtml(v.note)}</p>`,
            '</div>',
        ].join('\n'))
        .join('\n');
}

/** 상세 수치 테이블 카드 HTML */
function renderSectionsHtml(input: GateReportInput): string {
    const row = (label: string, value: string) =>
        `<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(value)}</td></tr>`;
    const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
    const wf = input.workflow;
    const orch = input.orchestration;
    const tail = input.tailShadow;
    const rate = (num: number, den: number) => (den > 0 ? pct(num / den) : '—');

    const table = (title: string, rows: string[]) =>
        `<div class="card"><h2>${escapeHtml(title)}</h2><table><tbody>${rows.join('')}</tbody></table></div>`;

    return [
        table('작업 워크플로우 상세', [
            row('기간 내 작업', String(wf.totalTasks)),
            row('turn retry 발생 작업', `${wf.retryTasks} (${rate(wf.retryTasks, wf.totalTasks)})`),
            row('HITL 무응답 강등 작업', `${wf.hitlDegradeTasks} (${rate(wf.hitlDegradeTasks, wf.totalTasks)})`),
            row('plan 귀속 커버리지', pct(wf.planCoverage)),
            row('완료 작업 / 무판정 비율', `${wf.completedTasks} / ${pct(wf.unjudgedRate)}`),
            row('goal_incomplete 실패', String(wf.goalIncompleteTasks)),
        ]),
        table('오케스트레이션 자동 배정 상세', [
            row('계측 턴', String(orch.totalTurns)),
            row('도구 노출 턴', String(orch.exposedTurns)),
            row('호출 턴 (노출 대비)', `${orch.calledTurns} (${rate(orch.calledTurns, orch.exposedTurns)})`),
            row('성공 턴 (호출 대비)', `${orch.successTurns} (${rate(orch.successTurns, orch.calledTurns)})`),
        ]),
        table('Tail 셰도우 상세', [
            row('셰도우 결정', String(tail.totalDecisions)),
            row('tail 판정', `${tail.tailDecisions} (${rate(tail.tailDecisions, tail.totalDecisions)})`),
            row('캘리브레이션 라벨', String(tail.labeledDecisions)),
            row('마지막 적재 (전기간)', tail.lastDecisionAt ?? '없음'),
        ]),
    ].join('\n');
}

/** 템플릿 로드 + 치환 렌더 — 동적 값은 렌더 헬퍼들이 이미 escape 했다 */
export async function renderGateReportHtml(
    input: GateReportInput,
    windowDays: number,
    generatedAt: string,
): Promise<string> {
    const template = await fs.readFile(path.join(REPORT_TEMPLATES_DIR, 'gate-report.html'), 'utf8');
    return template
        .replace(/\{\{GENERATED_AT\}\}/g, escapeHtml(generatedAt))
        .replace(/\{\{WINDOW_DAYS\}\}/g, String(windowDays))
        .replace('{{VERDICTS_HTML}}', renderVerdictsHtml(buildGateVerdicts(input, GATE_REPORT.MIN_SAMPLE)))
        .replace('{{SECTIONS_HTML}}', renderSectionsHtml(input));
}

/** Stage 1 집계 repository 들에서 판정 입력을 수집한다 */
async function collectGateReportInput(days: number): Promise<GateReportInput> {
    const { getPool } = await import('../data/models/unified-database');
    const { RoutingMetricsRepository } = await import('../data/repositories/routing-metrics-repository');
    const { AgentTaskMetricsRepository } = await import('../data/repositories/agent-task-metrics-repository');
    const pool = getPool();
    const routingRepo = new RoutingMetricsRepository(pool);
    const taskRepo = new AgentTaskMetricsRepository(pool);

    const [verdictRows, failureRows, interventionRow, coverageRow, dispatchRow, tailRow] = await Promise.all([
        taskRepo.getCompletionVerdictDistribution(days),
        taskRepo.getFailureReasons(days, 20),
        taskRepo.getInterventionCounts(days),
        taskRepo.getPlanAttributionCoverage(days),
        routingRepo.getOrchestrationDispatchSummary(days),
        routingRepo.getTailShadowSummary(days),
    ]);

    const completedTasks = verdictRows.reduce((sum, r) => sum + Number(r.tasks), 0);
    const unjudgedTasks = verdictRows
        .filter((r) => r.judge_verdict !== 'achieved' && r.judge_verdict !== 'not_achieved')
        .reduce((sum, r) => sum + Number(r.tasks), 0);
    const totalSteps = Number(coverageRow.total_steps);
    const goalIncompleteTasks = failureRows
        .filter((r) => r.reason.includes('goal_incomplete'))
        .reduce((sum, r) => sum + Number(r.tasks), 0);

    return {
        workflow: {
            totalTasks: Number(interventionRow.total_tasks),
            retryTasks: Number(interventionRow.retry_tasks),
            hitlDegradeTasks: Number(interventionRow.hitl_degrade_tasks),
            planCoverage: totalSteps > 0 ? Number(coverageRow.attributed_steps) / totalSteps : 0,
            completedTasks,
            unjudgedRate: completedTasks > 0 ? unjudgedTasks / completedTasks : 0,
            goalIncompleteTasks,
        },
        orchestration: {
            totalTurns: Number(dispatchRow.total_turns),
            exposedTurns: Number(dispatchRow.exposed_turns),
            calledTurns: Number(dispatchRow.called_turns),
            successTurns: Number(dispatchRow.success_turns),
        },
        tailShadow: {
            totalDecisions: Number(tailRow.total_decisions),
            tailDecisions: Number(tailRow.tail_decisions),
            labeledDecisions: Number(tailRow.labeled_decisions),
            // pg 는 TIMESTAMPTZ 를 Date 로 돌려준다 — 렌더는 문자열 전제라 여기서 정규화.
            lastDecisionAt: tailRow.last_decision_at == null
                ? null
                : new Date(tailRow.last_decision_at).toISOString(),
        },
    };
}

/** admin 전원에게 리포트 준비 push — 실패는 리포트 생성을 뒤집지 않는다(fire-and-forget) */
async function notifyAdmins(dateStr: string): Promise<void> {
    try {
        const { getUserManager } = await import('../data/user-manager');
        const { getPushService } = await import('../services/PushService');
        const ids = await getUserManager().getAdminUserIds();
        for (const id of ids) {
            void getPushService().sendPush(id, {
                title: 'OpenMake 주간 게이트 리포트',
                body: `${dateStr} 게이트 판정 리포트가 준비되었습니다.`,
                url: '/api/metrics/routing/report',
            }).catch(() => { /* noop */ });
        }
    } catch (e) {
        logger.warn(`[GateReport] admin push 실패(무시): ${e instanceof Error ? e.message : e}`);
    }
}

/**
 * due 판정 + 생성 스윕 — 설정 요일에 당일 스냅샷이 없으면 생성한다.
 * @returns 이번 호출에서 새로 생성했으면 true
 */
export async function runGateReportSweep(now: Date = new Date()): Promise<boolean> {
    if (!GATE_REPORT.ENABLED) return false;
    if (gateReportWeekday(now, GATE_REPORT.TZ) !== GATE_REPORT.WEEKDAY) return false;

    const dateStr = gateReportDateStr(now, GATE_REPORT.TZ);
    const datedPath = path.join(GATE_REPORT.DIR, `${dateStr}.html`);
    try {
        await fs.access(datedPath);
        return false; // 당일분 존재 — 멱등
    } catch { /* 미생성 — 진행 */ }

    const input = await collectGateReportInput(GATE_REPORT.WINDOW_DAYS);
    const html = await renderGateReportHtml(input, GATE_REPORT.WINDOW_DAYS, dateStr);
    await fs.mkdir(GATE_REPORT.DIR, { recursive: true });
    await fs.writeFile(datedPath, html);
    await fs.writeFile(path.join(GATE_REPORT.DIR, 'latest.html'), html);
    logger.info(`[GateReport] 주간 게이트 리포트 생성: ${datedPath} (${html.length} bytes)`);
    await notifyAdmins(dateStr);
    return true;
}

/**
 * 스케줄러 등록 — 부팅 1회 + 주기 due 체크. 파일 존재가 멱등 마커라 중복 실행에 안전하다.
 * @returns 활성화 여부 (플래그 OFF 면 false)
 */
export function startGateReportScheduler(): boolean {
    if (!GATE_REPORT.ENABLED) return false;
    void runGateReportSweep().catch((e) => {
        logger.warn(`[GateReport] 부팅 스윕 실패(무시): ${e instanceof Error ? e.message : e}`);
    });
    const timer = setInterval(() => {
        void runGateReportSweep().catch((e) => {
            logger.warn(`[GateReport] 스윕 실패(무시): ${e instanceof Error ? e.message : e}`);
        });
    }, GATE_REPORT.CHECK_INTERVAL_MS);
    timer.unref();
    return true;
}
