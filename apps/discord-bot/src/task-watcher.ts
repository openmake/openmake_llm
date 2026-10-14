/**
 * 작업 하나를 지켜본다 — 상태를 주기적으로 조회해 진행 표시를 고치고, 승인 요청을 올리고, 끝나면 결과를 올린다.
 * 디스코드 호출은 주입받은 화면(WatchUi)으로만 한다(테스트와 진입점이 각자 구현을 준다).
 * 불변식: 화면 쪽 오류나 일시적인 조회 실패가 지켜보기를 죽이지 않는다.
 */
import { MAX_ARTIFACT_BYTES, MAX_ARTIFACT_FILES, toArtifactFiles, workspaceOutputs, type ArtifactFile, type ArtifactPlan, type WorkspaceFile } from './task-artifacts';
import { TaskApiError, type PendingApproval, type TaskArtifact, type TaskClient, type TaskSnapshot } from './task-client';

export interface WatchUi {
    /** 진행 표시 메시지 — 처음엔 올리고 그 뒤로는 고친다 */
    updateStatus(text: string): Promise<void>;
    postApproval(approval: PendingApproval): Promise<void>;
    /** 결과·안내 — 길 수 있다(나누는 것은 화면 쪽이 한다). files 는 결과와 함께 올릴 산출물 첨부 */
    postFinal(text: string, files?: ArtifactFile[]): Promise<void>;
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

/** gone = 작업이 서버에서 사라짐(삭제) */
export type WatchOutcome = 'completed' | 'failed' | 'cancelled' | 'timeout' | 'unreachable' | 'gone';

const TERMINAL_STATUSES: readonly string[] = ['completed', 'failed', 'cancelled'];
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 10;
/** 진행 표시에 싣는 목표의 상한(자) */
const GOAL_MAX_CHARS = 200;
/** 승인 문구에 싣는 도구 인자의 상한(자) */
const APPROVAL_ARGS_MAX_CHARS = 500;
/** 서버 apps/api llm/artifact-parser.ts 의 PLACEHOLDER_SCAN_PATTERN 과 같다 — `[[artifact:id]]`, `[[artifact:id:vN]]` */
const ARTIFACT_PLACEHOLDER = /\[\[artifact:([^\]]+?)(?::v\d+)?\]\]/g;

const STATUS_HEAD: Record<string, string> = {
    pending: '⏳ 작업 준비 중',
    queued: '⏳ 대기열에서 기다리는 중',
    running: '🛠️ 작업 진행 중',
    paused: '⏸️ 일시 정지 — 승인 또는 대기 중',
    completed: '✅ 작업 완료',
    failed: '❌ 작업 실패',
    cancelled: '🛑 작업 취소됨',
};

const MSG_UNREACHABLE = '⚠️ 서버에 연결하지 못해 이 작업을 더 지켜보지 않습니다. 작업 상태는 웹의 작업 화면에서 확인하세요. 멈추려면 /task-cancel 을 쓰세요.';
const MSG_GONE = 'ℹ️ 이 작업을 서버에서 찾을 수 없습니다(삭제됐을 수 있습니다). 지켜보기를 끝냅니다.';
const MSG_AUTH_REJECTED = '⚠️ 서버가 봇의 인증을 거절해 이 작업을 더 지켜보지 않습니다. 봇 관리자에게 알려 주세요. 작업 상태는 웹의 작업 화면에서 확인하세요.';
const MSG_FINAL_INCOMPLETE = '⚠️ 결과를 모두 올리지 못했습니다. 전체 결과는 웹의 작업 화면에서 확인하세요.';
const MSG_WATCH_TIMEOUT = '⏱️ 지켜보는 시간이 끝났습니다. 작업은 계속 진행 중입니다 — 웹의 작업 화면에서 확인하세요. 멈추려면 /task-cancel 을 쓰세요.';

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export function isTerminalStatus(status: string): boolean {
    return TERMINAL_STATUSES.includes(status);
}

/** segment — 이어가기(188)로 이어진 몇 번째 세그먼트인지. 2 이상일 때만 머리에 붙인다 */
export function formatStatus(snapshot: TaskSnapshot, info: WatchInfo, segment = 1): string {
    const prefix = segment > 1 ? `(세그먼트 ${segment}) ` : '';
    const head = prefix + (STATUS_HEAD[snapshot.status] ?? `작업 상태: ${snapshot.status}`);
    const turns = snapshot.maxTurns > 0 ? ` — ${snapshot.currentTurn}/${snapshot.maxTurns} 턴 (${snapshot.progress}%)` : '';
    return `${head}${turns}\n목표: ${truncate(info.goal.replace(/\s+/g, ' ').trim(), GOAL_MAX_CHARS)}\n실행 위치: ${info.executorLabel} · 승인: ${info.policyLabel}`;
}

/**
 * 본문의 자리표시자를 첨부 파일 이름(`📎 이름`)으로, 못 올린 산출물은 `📎 제목 — 웹의 작업 화면에서 확인` 으로 바꾼다.
 * 모르는 id 는 지운다. 자리표시자가 있었을 때만 연속 빈 줄을 둘까지 접는다
 */
function withArtifactRefs(raw: string, plan: ArtifactPlan): string {
    const replaced = raw.replace(ARTIFACT_PLACEHOLDER, (_m, id: string) => {
        const file = plan.files.find((f) => f.artifactId === id);
        if (file) return `📎 ${file.name}`;
        const missed = plan.leftOverArtifacts?.find((a) => a.id === id);
        return missed ? `📎 ${missed.title} — 웹의 작업 화면에서 확인` : '';
    });
    return (replaced === raw ? raw : replaced.replace(/\n[ \t]*(?:\n[ \t]*){2,}/g, '\n\n')).trim();
}

/** plan — 함께 첨부할 산출물. 하나라도 첨부하면 본문이 없을 때 첨부 안내로 대신하고, 못 올린 것만 웹으로 안내한다 */
export function formatFinal(snapshot: TaskSnapshot, plan: ArtifactPlan = { files: [], leftOver: 0 }): string {
    if (snapshot.status === 'failed') return `❌ 작업이 실패했습니다: ${snapshot.error ?? '사유 없음'}`;
    if (snapshot.status === 'cancelled') return '🛑 작업이 취소되었습니다.';
    const raw = snapshot.result ?? '';
    const stripped = raw.replace(ARTIFACT_PLACEHOLDER, '');
    if (plan.files.length > 0) {
        const body = stripped.trim() ? withArtifactRefs(raw, plan) : `산출물 ${plan.files.length}개를 첨부합니다.`;
        return `✅ 작업이 끝났습니다.\n\n${body}${plan.leftOver > 0 ? `\n\n📎 나머지 ${plan.leftOver}개는 웹의 작업 화면에서 확인하세요.` : ''}`;
    }
    const hadArtifact = stripped !== raw || plan.leftOver > 0;
    const body = stripped.trim() ? withArtifactRefs(raw, plan) : '(결과 본문 없음)';
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

/** 작업 공간 산출물 — 개수 상한 안의 것만 내려받는다. 상한 밖·실패한 것은 data null(못 올린 수로 센다) */
async function fetchWorkspaceFiles(
    client: Pick<TaskClient, 'listWorkspaceFiles' | 'downloadWorkspaceFile'>,
    taskId: string,
): Promise<WorkspaceFile[]> {
    let outputs: string[];
    try {
        outputs = workspaceOutputs(await client.listWorkspaceFiles(taskId));
    } catch (e) {
        console.warn(`[discord-bot] 작업 ${taskId} 작업 공간 파일 조회 실패 (나머지로 게시):`, e instanceof Error ? e.message : e);
        return [];
    }
    return Promise.all(outputs.map(async (path, i): Promise<WorkspaceFile> => {
        if (i >= MAX_ARTIFACT_FILES) return { path, data: null };
        try {
            return { path, data: await client.downloadWorkspaceFile(taskId, path, MAX_ARTIFACT_BYTES) };
        } catch (e) {
            console.warn(`[discord-bot] 작업 ${taskId} 작업 공간 파일 ${path} 내려받기 실패 (건너뜀):`, e instanceof Error ? e.message : e);
            return { path, data: null };
        }
    }));
}

export async function watchTask(
    client: Pick<TaskClient, 'getTask' | 'listPendingApprovals' | 'listArtifacts' | 'listWorkspaceFiles' | 'downloadWorkspaceFile'>,
    taskId: string,
    ui: WatchUi,
    opts: WatchOptions,
): Promise<WatchOutcome> {
    // 이어가기(188): 지켜보는 작업 id 는 체인을 따라 바뀐다. 시작 시각은 그대로 — watchMaxMs 는 체인 전체에 적용된다
    let current = taskId;
    let segment = 1;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = opts.now ?? Date.now;
    const maxFailures = opts.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
    /** 화면 쪽 오류는 삼킨다 — 디스코드 전송 실패가 지켜보기를 끝내면 승인·결과를 놓친다 */
    const safely = async (what: string, action: () => Promise<void>): Promise<boolean> => {
        try {
            await action();
            return true;
        } catch (e) {
            console.warn(`[discord-bot] 작업 ${current} ${what} 실패 (무시):`, e instanceof Error ? e.message : e);
            return false;
        }
    };

    const startedAt = now();
    const postedApprovals = new Set<string>();
    let lastStatusText = '';
    let failures = 0;

    for (;;) {
        let snapshot: TaskSnapshot;
        try {
            snapshot = await client.getTask(current);
            failures = 0;
        } catch (e) {
            // 404·401·403 은 기다려도 풀리지 않는다 — 일시 실패로 세지 않고 바로 알린다
            const status = e instanceof TaskApiError ? e.status : 0;
            if (status === 404) {
                await safely('안내 전송', () => ui.postFinal(MSG_GONE));
                return 'gone';
            }
            if (status === 401 || status === 403) {
                console.warn(`[discord-bot] 작업 ${current} 조회가 인증에서 거절됨(${status}) — 지켜보기 종료`);
                await safely('안내 전송', () => ui.postFinal(MSG_AUTH_REJECTED));
                return 'unreachable';
            }
            failures += 1;
            if (failures >= maxFailures) {
                console.warn(`[discord-bot] 작업 ${current} 조회 연속 ${failures}회 실패 — 지켜보기 종료:`, e instanceof Error ? e.message : e);
                await safely('안내 전송', () => ui.postFinal(MSG_UNREACHABLE));
                return 'unreachable';
            }
            await sleep(opts.pollMs);
            continue;
        }

        // 이어가기(188): 끝난 게 아니라 후속 세그먼트로 넘어간 것 — 같은 진행 메시지로 계속 지켜본다.
        // 진행 표시보다 먼저 본다 — 넘겨준 세그먼트의 '✅ 작업 완료' 가 진행 메시지에 잠깐이라도 보이지 않게
        if (snapshot.status === 'completed' && snapshot.continuedByTaskId) {
            current = snapshot.continuedByTaskId;
            segment += 1;
            postedApprovals.clear();
            lastStatusText = '';
            await sleep(opts.pollMs);
            continue;
        }

        const statusText = formatStatus(snapshot, opts, segment);
        if (statusText !== lastStatusText) {
            // 올리는 데 성공했을 때만 기억한다 — 실패하면 내용이 같아도 다음 조회에서 다시 시도한다
            if (await safely('진행 표시', () => ui.updateStatus(statusText))) lastStatusText = statusText;
        }

        if (isTerminalStatus(snapshot.status)) {
            // 산출물(응답 산출물·작업 공간 파일)은 완료일 때 한 번만 조회한다 — 어느 쪽이 실패해도 삼키고 나머지로 올린다
            let plan: ArtifactPlan = { files: [], leftOver: 0 };
            if (snapshot.status === 'completed') {
                const [artifacts, workspace] = await Promise.all([
                    client.listArtifacts(current).catch((e: unknown): TaskArtifact[] => {
                        console.warn(`[discord-bot] 작업 ${current} 산출물 조회 실패 (나머지로 게시):`, e instanceof Error ? e.message : e);
                        return [];
                    }),
                    fetchWorkspaceFiles(client, current),
                ]);
                plan = toArtifactFiles(artifacts, workspace);
            }
            const files = plan.files.length > 0 ? plan.files : undefined;
            // 결과가 중간에 끊기면 잘린 글이 완결된 것처럼 남는다 — 짧은 안내를 한 번 더 올린다
            if (!(await safely('결과 전송', () => ui.postFinal(formatFinal(snapshot, plan), files)))) {
                await safely('결과 안내 전송', () => ui.postFinal(MSG_FINAL_INCOMPLETE));
            }
            return snapshot.status as WatchOutcome;
        }

        if (snapshot.status === 'paused') {
            try {
                for (const approval of await client.listPendingApprovals(current)) {
                    if (postedApprovals.has(approval.approvalId)) continue;
                    // 올리는 데 성공한 요청만 기억한다 — 실패한 요청은 다음 조회에서 다시 올린다(버튼이 없으면 작업이 조용히 멈춘다)
                    if (await safely('승인 요청 전송', () => ui.postApproval(approval))) postedApprovals.add(approval.approvalId);
                }
            } catch (e) {
                console.warn(`[discord-bot] 작업 ${current} 승인 대기 조회 실패 (다음 주기에 재시도):`, e instanceof Error ? e.message : e);
            }
        }

        if (now() - startedAt >= opts.watchMaxMs) {
            await safely('안내 전송', () => ui.postFinal(MSG_WATCH_TIMEOUT));
            return 'timeout';
        }
        await sleep(opts.pollMs);
    }
}
