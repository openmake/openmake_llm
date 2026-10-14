/**
 * 채팅에서 위임한 백그라운드 작업 지켜보기 — 모델이 delegate_agent_task 로 만든 작업은 완료 알림이
 * WS 이벤트·웹 푸시로만 나가 봇은 결과를 받을 수 없었다(2026-10-14 운영). 응답의 agent_tasks 를 받아
 * 새로 만든 작업만 지켜보고 결과를 채널에 올린다. /task 명령과 독립 — /task 가 꺼져 있어도 동작한다.
 *
 * 규칙:
 *  - status 가 created 인 작업만 지켜본다(duplicate 는 이미 다른 턴에서 지켜보고 있거나 끝난 작업).
 *  - 같은 작업 id 는 동시에 두 번 지켜보지 않는다.
 *  - 채널당 동시에 지켜보는 위임 작업은 MAX_DELEGATED_WATCHES_PER_CHANNEL 개까지, 넘으면 안내 한 줄.
 * 상태는 메모리에만 둔다 — 봇을 재시작하면 지켜보기가 끊긴다(작업은 서버에서 계속 돈다, 받아들인 한계).
 */

/** 응답의 message.agent_tasks 항목 */
export interface AgentTaskRef {
    id: string;
    goal: string;
    status: 'created' | 'duplicate';
}

export const MAX_DELEGATED_WATCHES_PER_CHANNEL = 3;
/** 안내에 싣는 목표의 상한(자) */
const GOAL_MAX_CHARS = 60;

export interface DelegatedWatchRegistry {
    /** 지켜보는 중인 작업 id */
    watching: Set<string>;
    /** 채널 → 지켜보는 중인 위임 작업 수 */
    perChannel: Map<string, number>;
}

export function createDelegatedWatchRegistry(): DelegatedWatchRegistry {
    return { watching: new Set(), perChannel: new Map() };
}

export function formatNotWatched(task: AgentTaskRef): string {
    const goal = task.goal.replace(/\s+/g, ' ').trim();
    const short = goal.length > GOAL_MAX_CHARS ? `${goal.slice(0, GOAL_MAX_CHARS)}…` : goal;
    return `ℹ️ 「${short}」 — 이 작업은 지켜보지 않습니다 — 웹의 작업 화면에서 확인하세요.`;
}

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 지켜보기를 시작만 하고 기다리지 않는다(답변 전송을 막지 않는다).
 * @returns 지켜보기 시작한 작업 id 와 상한으로 지켜보지 않은 작업 id
 */
export function startDelegatedWatches(
    tasks: readonly AgentTaskRef[],
    deps: {
        channelId: string;
        registry: DelegatedWatchRegistry;
        watch: (task: AgentTaskRef) => Promise<unknown>;
        notifyNotWatched: (task: AgentTaskRef) => Promise<void>;
    },
): { started: string[]; notWatched: string[] } {
    const { channelId, registry } = deps;
    const started: string[] = [];
    const notWatched: string[] = [];
    for (const task of tasks) {
        if (task.status !== 'created' || registry.watching.has(task.id)) continue;
        const count = registry.perChannel.get(channelId) ?? 0;
        if (count >= MAX_DELEGATED_WATCHES_PER_CHANNEL) {
            notWatched.push(task.id);
            void deps.notifyNotWatched(task).catch((e) => console.warn(`[discord-bot] 위임 작업 ${task.id} 안내 전송 실패 (무시):`, reasonOf(e)));
            continue;
        }
        registry.watching.add(task.id);
        registry.perChannel.set(channelId, count + 1);
        started.push(task.id);
        let watching: Promise<unknown>;
        try {
            watching = deps.watch(task);
        } catch (e) {
            watching = Promise.reject(e);
        }
        void watching
            .catch((e) => console.error(`[discord-bot] 위임 작업 ${task.id} 지켜보기 오류:`, reasonOf(e)))
            .finally(() => {
                registry.watching.delete(task.id);
                const left = (registry.perChannel.get(channelId) ?? 1) - 1;
                if (left > 0) registry.perChannel.set(channelId, left);
                else registry.perChannel.delete(channelId);
            });
    }
    return { started, notWatched };
}
