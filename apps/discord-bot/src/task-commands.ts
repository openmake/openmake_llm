/**
 * /task 조정자 — 누가 작업을 시작·취소·승인할 수 있는지 확인하고, 채널별 진행 중 작업을 기억한다.
 * 디스코드를 모른다: 명령·버튼을 받은 쪽(task-discord)이 사용자·채널 id 와 화면(WatchUi)을 넘겨 준다.
 *
 * 규칙:
 *  - 허용 목록(DISCORD_TASK_ALLOWED_USERS)에 든 사용자만 작업을 시작한다. 목록이 비면 기능이 꺼진 것이다.
 *  - 한 채널에서 동시에 한 작업만 받는다.
 *  - 취소와 승인은 그 작업을 시작한 사람만 한다.
 *  - 지켜보기만 끝난 작업(시간 초과·서버 연결 실패)은 채널을 비워 주되, 시작한 사람이 /task-cancel 로 멈출 수 있게 기억한다.
 * 상태는 메모리에만 둔다 — 봇을 재시작하면 지켜보던 작업과 승인 버튼의 주인을 잊는다(작업은 서버에서 계속 돈다).
 */
import type { TaskApprovalPolicy, TaskExecutor } from './config';
import type { TaskClient, TaskInputAttachments } from './task-client';
import { watchTask, type WatchUi } from './task-watcher';

export interface TaskControllerConfig {
    allowedUsers: string[];
    executor: TaskExecutor;
    approvalPolicy: TaskApprovalPolicy;
    pollMs: number;
    watchMaxMs: number;
}

export type StartResult = { ok: true; taskId: string } | { ok: false; reason: string };

export interface DecideResult {
    /** 그 승인 요청이 끝났는가 — 참이면 버튼을 지운다 */
    settled: boolean;
    text: string;
}

export interface TaskController {
    isEnabled(): boolean;
    /** attachments — /task 의 첨부 옵션을 내려받은 것. 작업 생성에 그대로 넘긴다 */
    start(req: { userId: string; channelId: string; goal: string; ui: WatchUi; attachments?: TaskInputAttachments }): Promise<StartResult>;
    cancel(req: { userId: string; channelId: string }): Promise<string>;
    decide(req: { userId: string; approvalId: string; decision: 'approve' | 'reject' }): Promise<DecideResult>;
    /** /task 밖에서 올린 승인 요청(채팅에서 위임한 작업)의 주인을 적는다 — 그 사람만 버튼으로 결정한다 */
    trackApproval(approvalId: string, ownerId: string): void;
}

export const EXECUTOR_LABEL: Record<TaskExecutor, string> = { sandbox: '서버 격리 환경', local: '이 기기(Companion)' };
const POLICY_LABEL: Record<TaskApprovalPolicy, string> = { all: '전부', 'high-risk': '고위험만', none: '없음' };

const MSG = {
    notAllowed: '이 명령을 쓸 권한이 없습니다.',
    emptyGoal: '작업 목표를 적어 주세요.',
    busy: '이 채널에서 이미 작업이 진행 중입니다. 끝난 뒤 다시 시도하거나 /task-cancel 로 멈추세요.',
    cannotPost: '이 채널에 메시지를 올릴 수 없어 작업을 시작하지 않았습니다. 봇의 채널 권한을 확인하세요.',
    preparing: '⏳ 작업을 준비하는 중…',
    noDevice: 'Companion 이 연결돼 있지 않아 작업을 시작하지 않았습니다. 데스크톱 앱을 연결한 뒤 다시 시도하세요.',
    startFailed: '작업을 시작하지 못했습니다',
    noActive: '이 채널에 진행 중인 작업이 없습니다.',
    notStarter: '작업을 시작한 사람만 할 수 있습니다.',
    cancelRequested: '취소를 요청했습니다.',
    cancelUnwatchedRequested: '지켜보기가 끝난 작업의 취소를 요청했습니다. 결과는 웹의 작업 화면에서 확인하세요.',
    cancelFailed: '취소하지 못했습니다',
    unknownApproval: '이 승인 요청을 찾을 수 없습니다. 이미 처리됐거나 봇이 재시작됐을 수 있습니다 — 웹의 작업 화면에서 확인하세요.',
    approved: '✅ 승인됨',
    rejected: '🚫 거절됨',
    gone: 'ℹ️ 이미 처리된 요청입니다.',
    decideFailed: '결정을 전하지 못했습니다',
} as const;

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createTaskController(deps: {
    client: TaskClient;
    config: TaskControllerConfig;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}): TaskController {
    const { client, config } = deps;
    /** 채널 → 진행 중 작업. taskId 가 null 이면 만드는 중(자리만 잡은 상태) */
    const active = new Map<string, { taskId: string | null; starterId: string }>();
    /** 채널 → 지켜보기만 끝나고 서버에서는 아직 돌 수 있는 마지막 작업 */
    const unwatched = new Map<string, { taskId: string; starterId: string }>();
    /** 승인 id → 그 작업을 시작한 사람. 지켜보기가 승인 요청을 올릴 때 적는다 */
    const approvalOwners = new Map<string, string>();

    return {
        isEnabled: () => config.allowedUsers.length > 0,

        async start(req) {
            if (!config.allowedUsers.includes(req.userId)) return { ok: false, reason: MSG.notAllowed };
            const goal = req.goal.trim();
            if (!goal) return { ok: false, reason: MSG.emptyGoal };
            if (active.has(req.channelId)) return { ok: false, reason: MSG.busy };
            // 아래의 첫 await 전에 자리를 잡는다 — 거의 동시에 온 두 번째 요청이 여기서 걸린다
            const slot: { taskId: string | null; starterId: string } = { taskId: null, starterId: req.userId };
            active.set(req.channelId, slot);

            // 작업을 만들기 전에 채널에 글을 올릴 수 있는지 먼저 본다 — 못 올리면 진행·승인·결과가 모두 안 보인다
            try {
                await req.ui.updateStatus(MSG.preparing);
            } catch {
                active.delete(req.channelId);
                return { ok: false, reason: MSG.cannotPost };
            }

            let taskId: string | null = null;
            try {
                if (config.executor === 'local' && !(await client.isDeviceConnected())) {
                    active.delete(req.channelId);
                    return { ok: false, reason: MSG.noDevice };
                }
                taskId = await client.createTask(goal, config.executor, req.attachments);
                slot.taskId = taskId;
                await client.executeTask(taskId, config.approvalPolicy);
            } catch (e) {
                active.delete(req.channelId);
                // 만들기는 됐는데 실행이 안 된 작업을 남기지 않는다
                if (taskId) await client.cancelTask(taskId).catch(() => undefined);
                return { ok: false, reason: `${MSG.startFailed}: ${reasonOf(e)}` };
            }

            const startedTaskId = taskId;
            const ui: WatchUi = {
                updateStatus: (text) => req.ui.updateStatus(text),
                postFinal: (text, files) => req.ui.postFinal(text, files),
                postApproval: async (approval) => {
                    approvalOwners.set(approval.approvalId, req.userId);
                    await req.ui.postApproval(approval);
                },
            };
            void watchTask(client, startedTaskId, ui, {
                goal,
                executorLabel: EXECUTOR_LABEL[config.executor],
                policyLabel: POLICY_LABEL[config.approvalPolicy],
                pollMs: config.pollMs,
                watchMaxMs: config.watchMaxMs,
                ...(deps.sleep ? { sleep: deps.sleep } : {}),
                ...(deps.now ? { now: deps.now } : {}),
            })
                .then((outcome) => {
                    if (outcome === 'timeout' || outcome === 'unreachable') unwatched.set(req.channelId, { taskId: startedTaskId, starterId: req.userId });
                })
                .catch((e) => console.error(`[discord-bot] 작업 ${startedTaskId} 지켜보기 오류:`, reasonOf(e)))
                .finally(() => {
                    if (active.get(req.channelId)?.taskId === startedTaskId) active.delete(req.channelId);
                });
            return { ok: true, taskId: startedTaskId };
        },

        async cancel(req) {
            const slot = active.get(req.channelId);
            const left = slot ? undefined : unwatched.get(req.channelId);
            const target = slot ?? left;
            if (!target || !target.taskId) return MSG.noActive;
            if (target.starterId !== req.userId) return MSG.notStarter;
            try {
                await client.cancelTask(target.taskId);
                if (!left) return MSG.cancelRequested;
                unwatched.delete(req.channelId);
                return MSG.cancelUnwatchedRequested;
            } catch (e) {
                return `${MSG.cancelFailed}: ${reasonOf(e)}`;
            }
        },

        trackApproval(approvalId, ownerId) {
            approvalOwners.set(approvalId, ownerId);
        },

        async decide(req) {
            const owner = approvalOwners.get(req.approvalId);
            if (!owner) return { settled: false, text: MSG.unknownApproval };
            if (owner !== req.userId) return { settled: false, text: MSG.notStarter };
            try {
                const outcome = await client.decideApproval(req.approvalId, req.decision);
                approvalOwners.delete(req.approvalId);
                if (outcome === 'gone') return { settled: true, text: MSG.gone };
                return { settled: true, text: req.decision === 'approve' ? MSG.approved : MSG.rejected };
            } catch (e) {
                return { settled: false, text: `${MSG.decideFailed}: ${reasonOf(e)}` };
            }
        },
    };
}
