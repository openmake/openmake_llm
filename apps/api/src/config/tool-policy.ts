/**
 * 도구 정책 — 위험 등급표 (로드맵 2단계 "Policy and Approval", 2026-09-16).
 *
 * 종전엔 승인 여부가 도구 **이름 목록**(HIGH_RISK_TOOLS 4개·NO_APPROVAL_TOOLS)으로 정해져
 * "왜 승인이 필요한지"가 코드를 읽어야만 보였고, 새 도구는 등급 없이 정책 'all' 에서만 걸렸다.
 * 여기서는 도구를 **위험 등급**으로 분류하고, 승인 정책(all/high-risk/none)은 등급에 대한 규칙이 된다.
 * LLM 왕복 없는 결정적 표다(판단 경계 A형이 아니다) — 09-01 반려된 "앞단 LLM 정책 엔진"과 다르다.
 *
 * 등급:
 *   read        읽기 전용(파일 보기·코드 탐색·계획 조회)
 *   write       작업 디렉토리 안 파일 생성·수정
 *   destructive 삭제
 *   exec        임의 코드 실행(셸·파이썬·저장 절차 재생)
 *   network     브라우저 등 네트워크 egress
 *   external    호스트에서 도는 내장·MCP 도구(검색·이미지 생성 등 외부 API)
 *   control     제어 시그널·플래닝·위임(부작용 없음)
 *
 * 정책 매핑(현행 판정과 동일 — approval-gate 테스트가 고정):
 *   none      → 없음
 *   high-risk → exec · network · destructive + 자격증명 파일 쓰기(sensitive)
 *   all       → control 제외 전부
 *
 * 재분류는 배포 없이 env `TOOL_RISK_OVERRIDES_JSON`('{"도구명":"등급"}') 으로(L1). 표 밖 도구는
 * `external`(정책 all 에서만 승인) — 종전과 같다.
 *
 * @module config/tool-policy
 */
import type { TaskSandboxApprovalPolicy } from './task-sandbox';

export type ToolRiskClass = 'read' | 'write' | 'destructive' | 'exec' | 'network' | 'external' | 'control';

export const TOOL_RISK_CLASSES: readonly ToolRiskClass[] = ['read', 'write', 'destructive', 'exec', 'network', 'external', 'control'];

/** 인자에 따라 등급이 갈리는 도구 — 값이 함수면 인자를 본다. */
type RiskRule = ToolRiskClass | ((args: Record<string, unknown>) => ToolRiskClass);

const FILE_OPS_RISK: Record<string, ToolRiskClass> = { read: 'read', list: 'read', tree: 'read', write: 'write', delete: 'destructive' };
const EDITOR_RISK: Record<string, ToolRiskClass> = { view: 'read', create: 'write', str_replace: 'write', insert: 'write' };

const TOOL_RISK: Readonly<Record<string, RiskRule>> = {
    // 샌드박스 도구
    bash: 'exec',
    python_execute: 'exec',
    skill_run: 'exec',
    browser: 'network',
    file_ops: (args) => FILE_OPS_RISK[String(args.op)] ?? 'write',
    str_replace_editor: (args) => EDITOR_RISK[String(args.command)] ?? 'write',
    grep_code: 'read',
    repo_map: 'read',
    // 외부 MCP resources/prompts 메타 도구(F13.2) — 읽기 전용
    mcp_list_resources: 'read',
    mcp_read_resource: 'read',
    mcp_get_prompt: 'read',
    skill_save: 'write',
    // 제어·플래닝·위임 — 부작용 없음
    terminate: 'control',
    ask_human: 'control',
    // 외부 MCP 서버의 사용자 입력 요청(F13.10) — ask_human 과 같은 질문 채널
    mcp_elicit: 'control',
    plan_create: 'control',
    plan_update: 'control',
    plan_view: 'control',
    delegate: 'control',
    spawn_agents: 'control',
    start_discussion: 'control',
};

/** env 재분류 — 잘못된 JSON·모르는 등급은 무시하고 로그 없이 표를 그대로 쓴다(부팅을 막지 않음). */
function loadOverrides(): Record<string, ToolRiskClass> {
    const raw = process.env.TOOL_RISK_OVERRIDES_JSON;
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const out: Record<string, ToolRiskClass> = {};
        for (const [name, cls] of Object.entries(parsed)) {
            if (typeof cls === 'string' && (TOOL_RISK_CLASSES as readonly string[]).includes(cls)) out[name] = cls as ToolRiskClass;
        }
        return out;
    } catch { return {}; }
}
const OVERRIDES = loadOverrides();

/** PURE: 도구 호출의 위험 등급. 표 밖 도구는 external. */
export function classifyToolRisk(toolName: string, args: Record<string, unknown> = {}): ToolRiskClass {
    const override = OVERRIDES[toolName];
    if (override) return override;
    const rule = TOOL_RISK[toolName];
    if (!rule) return 'external';
    return typeof rule === 'function' ? rule(args) : rule;
}

/**
 * 승인 정책·task 자동승인과 무관하게 **항상 사람의 응답을 기다리는** 도구 — 질문 자체가 목적이다.
 * approval-gate 의 자동승인 예외·HITL 무응답 강등 제거 대상이 이 집합을 쓴다(F13.10 에서 mcp_elicit 추가).
 */
export const HITL_ALWAYS_WAIT_TOOLS: ReadonlySet<string> = new Set(['ask_human', 'mcp_elicit']);

/** high-risk 정책이 승인으로 올리는 등급. */
const HIGH_RISK_CLASSES: ReadonlySet<ToolRiskClass> = new Set(['exec', 'network', 'destructive']);

/**
 * PURE: 정책 × 등급 → 승인 필요 여부.
 * sensitiveWrite: 자격증명 파일을 바꾸는 호출(approval-gate 가 경로로 판정) — high-risk 에서도 승인.
 */
export function policyRequiresApproval(policy: TaskSandboxApprovalPolicy, risk: ToolRiskClass, sensitiveWrite = false): boolean {
    if (policy === 'none' || risk === 'control') return false;
    if (policy === 'all') return true;
    return HIGH_RISK_CLASSES.has(risk) || sensitiveWrite;
}
