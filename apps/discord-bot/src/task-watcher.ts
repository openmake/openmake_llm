/**
 * 작업 하나를 지켜본다 — 상태를 주기적으로 조회해 진행 표시를 고치고, 승인 요청을 올리고, 끝나면 결과를 올린다.
 * 디스코드 호출은 주입받은 화면(WatchUi)으로만 한다(테스트와 진입점이 각자 구현을 준다).
 * 불변식: 화면 쪽 오류나 일시적인 조회 실패가 지켜보기를 죽이지 않는다.
 */
import type { PendingApproval, TaskClient, TaskSnapshot } from './task-client';

export interface WatchUi {
    /** 진행 표시 메시지 — 처음엔 올리고 그 뒤로는 고친다 */
    updateStatus(text: string): Promise<void>;
    postApproval(approval: PendingApproval): Promise<void>;
    /** 결과·안내 — 길 수 있다(나누는 것은 화면 쪽이 한다) */
    postFinal(text: string): Promise<void>;
}

export interface WatchInfo {
    goal: string;
    /** 실행 위치를 사람이 읽는 말로 */
    executorLabel: string;
    /** 승인 방식을 사람이 읽는 말로 */
    policyLabel: string;
}

export interface WatchOptions extends WatchInfo {
    pollMs: number;
    watchMaxMs: number;
    /** 조회가 연속으로 이만큼 실패하면 지켜보기를 끝낸다 */
    maxConsecutiveFailures?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

export type WatchOutcome = 'completed' | 'failed' | 'cancelled' | 'timeout' | 'unreachable';

const TERMINAL_STATUSES: readonly string[] = ['completed', 'failed', 'cancelled'];
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 10;
/** 진행 표시에 싣는 목표의 상한(자) */
const GOAL_MAX_CHARS = 200;
/** 승인 문구에 싣는 도구 인자의 상한(자) */
const APPROVAL_ARGS_MAX_CHARS = 500;
const ARTIFACT_PLACEHOLDER = /\[\[artifact:[^\]]+\]\]/g;

const STATUS_HEAD: Record<string, string> = {
    pending: '⏳ 작업 준비 중',
    queued: '⏳ 대기열에서 기다리는 중',
    running: '🛠️ 작업 진행 중',
    paused: '⏸️ 일시 정지 — 승인 또는 대기 중',
    completed: '✅ 작업 완료',
    failed: '❌ 작업 실패',
    cancelled: '🛑 작업 취소됨',
};

const MSG_UNREACHABLE = '⚠️ 서버에 연결하지 못해 이 작업을 더 지켜보지 않습니다. 작업 상태는 웹의 작업 화면에서 확인하세요.';
const MSG_WATCH_TIMEOUT = '⏱️ 지켜보는 시간이 끝났습니다. 작업은 계속 진행 중입니다 — 웹의 작업 화면에서 확인하세요.';

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export function isTerminalStatus(status: string): boolean {
    return TERMINAL_STATUSES.includes(status);
}

export function formatStatus(snapshot: TaskSnapshot, info: WatchInfo): string {
    const head = STATUS_HEAD[snapshot.status] ?? `작업 상태: ${snapshot.status}`;
    const turns = snapshot.maxTurns > 0 ? ` — ${snapshot.currentTurn}/${snapshot.maxTurns} 턴 (${snapshot.progress}%)` : '';
    return `${head}${turns}\n목표: ${truncate(info.goal.replace(/\s+/g, ' ').trim(), GOAL_MAX_CHARS)}\n실행 위치: ${info.executorLabel} · 승인: ${info.policyLabel}`;
}

export function formatFinal(snapshot: TaskSnapshot): string {
    if (snapshot.status === 'failed') return `❌ 작업이 실패했습니다: ${snapshot.error ?? '사유 없음'}`;
    if (snapshot.status === 'cancelled') return '🛑 작업이 취소되었습니다.';
    const raw = snapshot.result ?? '';
    const hadArtifact = ARTIFACT_PLACEHOLDER.test(raw);
    ARTIFACT_PLACEHOLDER.lastIndex = 0;
    const body = raw.replace(ARTIFACT_PLACEHOLDER, '').trim() || '(결과 본문 없음)';
    return `✅ 작업이 끝났습니다.\n\n${body}${hadArtifact ? '\n\n📎 산출물은 웹의 작업 화면에서 확인하세요.' : ''}`;
}

export function formatApproval(approval: PendingApproval): string {
    const args = approval.args;
    const command = args && typeof args === 'object' ? (args as { command?: unknown }).command : undefined;
    const text = typeof command === 'string' && Object.keys(args as object).length === 1
        ? command
        : JSON.stringify(args ?? {}, null, 1);
    // 코드 블록 안이라 ``` 가 들어오면 블록이 깨진다 — 비슷하게 보이는 글자로 바꾼다
    const safe = truncate(text, APPROVAL_ARGS_MAX_CHARS).replace(/```/g, 'ʼʼʼ');
    return `⚠️ 승인이 필요합니다 — ${approval.toolName}\n\`\`\`\n${safe}\n\`\`\``;
}

export async function watchTask(
    client: Pick<TaskClient, 'getTask' | 'listPendingApprovals'>,
    taskId: string,
    ui: WatchUi,
    opts: WatchOptions,
): Promise<WatchOutcome> {
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = opts.now ?? Date.now;
    const maxFailures = opts.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
    /** 화면 쪽 오류는 삼킨다 — 디스코드 전송 실패가 지켜보기를 끝내면 승인·결과를 놓친다 */
    const safely = async (what: string, action: () => Promise<void>): Promise<void> => {
        try {
            await action();
        } catch (e) {
            console.warn(`[discord-bot] 작업 ${taskId} ${what} 실패 (무시):`, e instanceof Error ? e.message : e);
        }
    };

    const startedAt = now();
    const postedApprovals = new Set<string>();
    let lastStatusText = '';
    let failures = 0;

    for (;;) {
        let snapshot: TaskSnapshot;
        try {
            snapshot = await client.getTask(taskId);
            failures = 0;
        } catch (e) {
            failures += 1;
            if (failures >= maxFailures) {
                console.warn(`[discord-bot] 작업 ${taskId} 조회 연속 ${failures}회 실패 — 지켜보기 종료:`, e instanceof Error ? e.message : e);
                await safely('안내 전송', () => ui.postFinal(MSG_UNREACHABLE));
                return 'unreachable';
            }
            await sleep(opts.pollMs);
            continue;
        }

        const statusText = formatStatus(snapshot, opts);
        if (statusText !== lastStatusText) {
            await safely('진행 표시', () => ui.updateStatus(statusText));
            lastStatusText = statusText;
        }

        if (isTerminalStatus(snapshot.status)) {
            await safely('결과 전송', () => ui.postFinal(formatFinal(snapshot)));
            return snapshot.status as WatchOutcome;
        }

        if (snapshot.status === 'paused') {
            try {
                for (const approval of await client.listPendingApprovals(taskId)) {
                    if (postedApprovals.has(approval.approvalId)) continue;
                    postedApprovals.add(approval.approvalId);
                    await safely('승인 요청 전송', () => ui.postApproval(approval));
                }
            } catch (e) {
                console.warn(`[discord-bot] 작업 ${taskId} 승인 대기 조회 실패 (다음 주기에 재시도):`, e instanceof Error ? e.message : e);
            }
        }

        if (now() - startedAt >= opts.watchMaxMs) {
            await safely('안내 전송', () => ui.postFinal(MSG_WATCH_TIMEOUT));
            return 'timeout';
        }
        await sleep(opts.pollMs);
    }
}
