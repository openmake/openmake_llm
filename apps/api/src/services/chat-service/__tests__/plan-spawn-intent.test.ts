/**
 * 계획수립·병렬 위임 의도 프리필터 회귀 테스트 (2026-08-11).
 *
 * - create_plan(review role 소비처)은 always-on/스킬바인딩/토글 어디에도 없어
 *   채팅에서 도달 불가능하던 갭을 PLAN_INTENT_PATTERNS 강제 포함 + 첫 턴
 *   tool_choice 강제로 해소했다.
 * - spawn_agents 는 상시 노출인데도 description 의 보수적 경고 탓에 자발 채택이
 *   0 이었다 — SPAWN_INTENT_PATTERNS 매칭 턴에만 사용 가이드를 주입한다.
 */
import { PLAN_INTENT_PATTERNS, SPAWN_INTENT_PATTERNS } from '../../../config/runtime-limits';
import { buildExternalToolPlan } from '../external-tool-plan';
import { buildExternalSystemPrompt } from '../external-system-prompt';
import type { ChatMessageRequest } from '../../chat-service-types';
import type { ResolvedProvider } from '../../../providers/provider-router';
import type { ToolDefinition } from '../../../llm';

const matchesAny = (patterns: readonly RegExp[], msg: string) =>
    patterns.some((re) => re.test(msg));

describe('PLAN_INTENT_PATTERNS', () => {
    it.each([
        '회원 탈퇴(계정 삭제) 기능 구현 계획을 세워줘',
        '결제 모듈 개발 계획 수립해줘',
        'create_plan 도구로 계획 만들어줘',
        'write an implementation plan for the auth service',
    ])('명시적 구현 계획 요청 매칭: %s', (msg) => {
        expect(matchesAny(PLAN_INTENT_PATTERNS, msg)).toBe(true);
    });

    it.each([
        '여행 계획 세워줘',
        '오늘 일정이 어떻게 돼?',
        '계획이라는 단어의 뜻을 알려줘',
    ])('일반 계획/무관 질의는 미매칭 (tool_choice 강제 오탐 방지): %s', (msg) => {
        expect(matchesAny(PLAN_INTENT_PATTERNS, msg)).toBe(false);
    });
});

describe('SPAWN_INTENT_PATTERNS', () => {
    it.each([
        '세 가지 주제를 병렬로 조사해줘',
        '서브에이전트로 나눠서 처리해줘',
        'research these topics in parallel',
    ])('병렬 위임 의도 매칭: %s', (msg) => {
        expect(matchesAny(SPAWN_INTENT_PATTERNS, msg)).toBe(true);
    });

    it.each([
        '안녕하세요',
        'TypeScript 제네릭 설명해줘',
    ])('일반 질의는 미매칭: %s', (msg) => {
        expect(matchesAny(SPAWN_INTENT_PATTERNS, msg)).toBe(false);
    });
});

describe('buildExternalToolPlan — create_plan 첫 턴 tool_choice 강제', () => {
    const createPlanTool: ToolDefinition = {
        type: 'function',
        function: { name: 'create_plan', description: 'plan', parameters: { type: 'object', properties: {} } },
    };
    const base = {
        allowedTools: [createPlanTool],
        toolCalling: true,
        wantsMap: false,
        orchestration: { discussion: false, taskDelegate: false },
    };
    const makeReq = (message: string) => ({ message } as ChatMessageRequest);

    it('계획수립 의도면 create_plan 을 첫 턴 강제한다', () => {
        const plan = buildExternalToolPlan({ ...base, req: makeReq('회원 탈퇴 기능 구현 계획을 세워줘') });
        expect(plan.forcedFirstTurnToolName).toBe('create_plan');
    });

    it('의도 미매칭이면 강제하지 않는다', () => {
        const plan = buildExternalToolPlan({ ...base, req: makeReq('안녕하세요') });
        expect(plan.forcedFirstTurnToolName).toBeUndefined();
    });

    it('도구 목록에 create_plan 이 없으면 강제하지 않는다 (graceful)', () => {
        const plan = buildExternalToolPlan({ ...base, allowedTools: [], req: makeReq('구현 계획을 세워줘') });
        expect(plan.forcedFirstTurnToolName).toBeUndefined();
    });
});

describe('buildExternalSystemPrompt — spawn 가이드 주입', () => {
    const resolved = { fullId: 'local-llm:qwen3.6-35b-a3b' } as ResolvedProvider;
    const baseReq = { message: '병렬로 조사해줘' } as ChatMessageRequest;

    const build = (wantsSpawn: boolean) => buildExternalSystemPrompt({
        req: baseReq,
        resolved,
        ctx: {} as never,
        wantsMap: false,
        orchestration: { discussion: false, taskDelegate: false },
        wantsSpawn,
    });

    it('wantsSpawn=true 면 [병렬 위임] 가이드를 주입한다', () => {
        expect(build(true)).toContain('[병렬 위임]');
    });

    it('wantsSpawn=false 면 주입하지 않는다 (상시 주입 금지)', () => {
        expect(build(false)).not.toContain('[병렬 위임]');
    });
});

describe('buildExternalToolPlan — spawn_agents 의도 게이팅 (프롬프트 다이어트 2026-09-05)', () => {
    const base = {
        allowedTools: [] as ToolDefinition[],
        toolCalling: true,
        wantsMap: false,
        orchestration: { discussion: false, taskDelegate: false },
    };
    const names = (msg: string) => buildExternalToolPlan({ ...base, req: { message: msg } as ChatMessageRequest })
        .tools.map((t) => t.function.name);

    it('병렬 위임 의도 턴에만 spawn_agents 를 노출한다', () => {
        // AGENT_SPAWN.ENABLED 가 꺼진 환경이면 양쪽 다 미노출 — 게이트 자체는 "의도 없으면 없다"로 고정
        expect(names('안녕하세요')).not.toContain('spawn_agents');
        const withIntent = names('세 가지 주제를 병렬로 조사해줘');
        const { AGENT_SPAWN } = jest.requireActual('../../../config/runtime-limits');
        if (AGENT_SPAWN.ENABLED) expect(withIntent).toContain('spawn_agents');
    });
});

describe('AGENT_TASK_INTENT_PATTERNS', () => {
    const { AGENT_TASK_INTENT_PATTERNS } = jest.requireActual('../../../config/runtime-limits');
    it.each([
        '아까 시킨 에이전트 작업 상태 어때?',
        '작업 결과 보여줘',
        'agent task 진행 확인',
        'what is the status of the task?',
    ])('작업 상태 질의 매칭: %s', (msg) => {
        expect(matchesAny(AGENT_TASK_INTENT_PATTERNS, msg)).toBe(true);
    });
    it.each(['오늘 날씨 알려줘', 'TypeScript 제네릭 설명해줘', '작업복 추천해줘'])('일반 질의 미매칭: %s', (msg) => {
        expect(matchesAny(AGENT_TASK_INTENT_PATTERNS, msg)).toBe(false);
    });
});
