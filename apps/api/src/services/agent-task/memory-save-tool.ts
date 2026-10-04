/**
 * 메모리 저장 도구(memory_save) — 에이전트 작업이 사용자 메모리(user_memories)에 짧은 사실 한 줄을 쓴다.
 * 새 저장소를 두지 않고 채팅 쪽 메모리와 같은 테이블·같은 검사(개수 상한·중복·민감 패턴)를 쓴다.
 *
 * 승인: 어느 승인 정책·자동승인에서도 호출마다 승인 카드가 뜬다(config/agent-task-approval 의 바닥 memory_write).
 * 그 바닥이 꺼져 있으면 도구를 싣지 않는다. 사용자 범위는 도구를 부른 작업의 소유자(ctx.userId)로만 정해진다.
 * 노출: 목표가 저장을 청할 때만 싣는다(MEMORY_SAVE_INTENT_PATTERNS) — 판단 경계 B형, LLM 호출 없음.
 * 문장 검사는 승인 카드보다 먼저 돈다(precheck) — 저장되지 않을 문장을 사람에게 묻지 않는다.
 *
 * @module services/agent-task/memory-save-tool
 */
import { randomUUID } from 'node:crypto';
import { getPool, getUnifiedDatabase } from '../../data/models/unified-database';
import { AGENT_TASK_STEERING_MARKER } from '../../prompts/agent-task-prompt';
import type { ChatMessage } from '../../llm/types';
import { UserMemoryRepository } from '../../data/repositories/user-memory-repository';
import type { ContributedAgentTaskTool } from '../chat-service/turn-integrations';
import { isDuplicateMemory, auditMemoryWrite } from '../chat-service/memory-extraction';
import { MEMORY_SAVE_TOOL, MEMORY_SAVE_TOOL_NAME, MEMORY_SAVE_INTENT_PATTERNS, MEMORY_SAVE_INJECTION_PATTERNS } from '../../config/agent-task-skill-memory';
import { APPROVAL_FLOOR } from '../../config/agent-task-approval';
import { MEMORY_EXTRACTION } from '../../config/memory-extraction';
import { isSensitiveMemory } from '../../config/memory-metadata';
import { PROCEDURAL_SECRET_VALUE_RES } from '../../config/procedural-skill';
import { MEMORY_SAVE_TOOL_TEXT as T } from '../../prompts/agent-task-skill-memory';
import { validatePromptInput } from '../../utils/input-sanitizer';
import { redactSecrets } from '../../utils/redact';

/** 도구가 쓰는 저장 경로 — UserMemoryRepository 가 그대로 맞는다(테스트에서 교체). */
export interface MemorySaveStore {
    countActiveByUser(userId: string): Promise<number>;
    listActiveByUser(userId: string, limit?: number): Promise<Array<{ content: string }>>;
    create(id: string, userId: string, content: string, source: 'explicit'): Promise<{ id: string }>;
}

const GUEST_USER_ID = 'guest';

/**
 * PURE: 저장 문장 검사 — 문제가 있으면 모델에 돌려줄 사유, 없으면 null.
 * 한 줄·길이, 지시문 형태(utils/input-sanitizer + MEMORY_SAVE_INJECTION_PATTERNS), 비밀값(메모리 민감 패턴 ·
 * 승인 카드 가림 패턴 utils/redact · 절차 스킬 저장의 비밀값 패턴). 가림 패턴에 걸리는 문장을 막으므로 통과한 문장은 승인 카드에 전문이 보인다.
 */
export function checkMemoryContent(raw: unknown): string | null {
    if (typeof raw !== 'string') return T.notString;
    const content = raw.trim();
    if (content.length < MEMORY_EXTRACTION.minLen) return T.tooShort(MEMORY_EXTRACTION.minLen);
    if (content.length > MEMORY_SAVE_TOOL.MAX_CHARS) return T.tooLong(MEMORY_SAVE_TOOL.MAX_CHARS);
    if (/[\r\n]/.test(content)) return T.multiline;
    if (!validatePromptInput(content).valid || MEMORY_SAVE_INJECTION_PATTERNS.some((re) => re.test(content))) return T.instructionLike;
    if (isSensitiveMemory(content) || redactSecrets(content) !== content || PROCEDURAL_SECRET_VALUE_RES.some((re) => re.test(content))) return T.secret;
    return null;
}

/**
 * PURE: 이 턴에 memory_save 를 모델에 보여 줄까 — 사용자가 저장을 청했을 때만(B형: 결정적 프리필터).
 * 사용자가 직접 쓴 글만 본다 — 목표(대화의 첫 사용자 메시지)와 작업 도중 보낸 지시(steering). 턴 관문(turn-gate)이 부른다.
 */
export function memorySaveExposed(conversation: readonly ChatMessage[], exposure: 'intent' | 'always' = MEMORY_SAVE_TOOL.EXPOSURE): boolean {
    if (exposure === 'always') return true;
    const goalAt = conversation.findIndex((m) => m.role === 'user');
    return conversation.some((m, i) => m.role === 'user' && typeof m.content === 'string'
        && (i === goalAt || m.content.startsWith(AGENT_TASK_STEERING_MARKER))
        && MEMORY_SAVE_INTENT_PATTERNS.some((re) => re.test(m.content as string)));
}

interface StepLike { step_type?: string | null; tool_name?: string | null; tool_output?: string | null; content?: string | null }

/** PURE: 단계 기록에서 저장에 성공한 memory_save 결과 수. */
export function countPriorMemorySaves(steps: readonly StepLike[]): number {
    return steps.filter((s) => s.step_type === 'tool_result' && s.tool_name === MEMORY_SAVE_TOOL_NAME
        && `${s.tool_output ?? ''}${s.content ?? ''}`.includes(T.savedPrefix)).length;
}

async function loadPriorMemorySaves(taskId: string): Promise<number> {
    return countPriorMemorySaves(await getUnifiedDatabase().getAgentTaskSteps(taskId) as StepLike[]);
}

/**
 * [memory_save] 또는 빈 배열(꺼짐 · 승인 바닥에 memory_write 없음). 도구는 늘 등록해 두고, 모델에 보여 줄지는
 * 턴마다 memorySaveExposed 가 정한다 — 작업 도중 "기억해"라고 지시해도 쓸 수 있게.
 * 저장 건수는 작업 단위로 센다(재개하면 단계 기록에서 이어 센다).
 */
export function createMemorySaveTools(
    taskId: string,
    deps: { enabled?: boolean; floorActive?: boolean; store?: MemorySaveStore; maxPerTask?: number; priorSaves?: () => Promise<number> } = {},
): ContributedAgentTaskTool[] {
    if (!(deps.enabled ?? MEMORY_SAVE_TOOL.ENABLED)) return [];
    // 항상 묻는 장치가 없으면 쓰기 도구를 주지 않는다 — 자동승인으로 사람 없이 메모리에 남는 길을 막는다.
    if (!(deps.floorActive ?? APPROVAL_FLOOR.has('memory_write'))) return [];
    const store = (): MemorySaveStore => deps.store ?? new UserMemoryRepository(getPool());
    const maxPerTask = deps.maxPerTask ?? MEMORY_SAVE_TOOL.MAX_PER_TASK;
    // 이 작업이 앞서 저장한 건수 — 재개하면 런타임이 새로 만들어지므로 단계 기록에서 한 번 읽어 이어 센다(조회 실패는 0 으로).
    let saved: number | null = null;
    const savedSoFar = async (): Promise<number> => {
        saved ??= await (deps.priorSaves ?? (() => loadPriorMemorySaves(taskId)))().catch(() => 0);
        return saved;
    };

    /** 저장할 수 없는 사유(없으면 null) — 승인 전과 저장 직전에 같은 검사를 돈다(승인을 기다리는 사이 상태가 바뀔 수 있다). */
    const refusal = async (args: Record<string, unknown>, userId: string): Promise<string | null> => {
        if (!userId || userId === GUEST_USER_ID) return T.guest;
        const problem = checkMemoryContent(args.content);
        if (problem) return problem;
        if (await savedSoFar() >= maxPerTask) return T.taskCap(maxPerTask);
        try {
            const s = store();
            if (await s.countActiveByUser(userId) >= MEMORY_EXTRACTION.maxCount) return T.userCap(MEMORY_EXTRACTION.maxCount);
            const existing = await s.listActiveByUser(userId, MEMORY_EXTRACTION.maxCount);
            return isDuplicateMemory(String(args.content), existing.map((m) => m.content)) ? T.duplicate : null;
        } catch (e) {
            return T.failed(e instanceof Error ? e.message : String(e));
        }
    };

    return [{
        tool: {
            name: MEMORY_SAVE_TOOL_NAME,
            description: T.description,
            inputSchema: {
                type: 'object',
                properties: { content: { type: 'string', description: T.contentArg } },
                required: ['content'],
            },
        },
        precheck: (args, ctx) => refusal(args, ctx.userId),
        run: async (args, ctx) => {
            const problem = await refusal(args, ctx.userId);
            if (problem) return { text: problem, isError: true };
            const content = String(args.content).trim();
            try {
                const row = await store().create(randomUUID(), ctx.userId, content, 'explicit');
                saved = (await savedSoFar()) + 1;
                // 설정 탭·자동 추출과 같은 감사 경로(memory.*) — 본문은 싣지 않는다.
                void auditMemoryWrite('memory.agent_task_created', ctx.userId, { id: row.id, source: 'explicit', length: content.length, taskId });
                return { text: T.saved(content) };
            } catch (e) {
                return { text: T.failed(e instanceof Error ? e.message : String(e)), isError: true };
            }
        },
    }];
}
