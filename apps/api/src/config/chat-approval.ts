/**
 * 채팅 도구 승인(W3 S3) — 채팅 도구 루프가 도구를 실행하기 전 사람의 승인을 받을지 정하는 설정.
 * 정책 값과 판정 규칙은 agent-task 와 같다(`config/task-sandbox` 의 all/high-risk/none, `config/tool-policy` 의 위험 등급).
 * 미설정이면 운영(production)은 high-risk, 개발·테스트는 none — 종전 채팅 동작을 개발 환경에서 바꾸지 않는다.
 *
 * @module config/chat-approval
 */
import type { TaskSandboxApprovalPolicy } from './task-sandbox';
import { boolEnvDefault, isProductionEnv } from './secure-defaults';

/** PURE: env 승인 정책 — 'all'|'high-risk'|'none' 만 받고 그 밖은 undefined(기본을 쓰게). */
export function parseApprovalPolicy(raw: string | undefined): TaskSandboxApprovalPolicy | undefined {
    return raw === 'all' || raw === 'high-risk' || raw === 'none' ? raw : undefined;
}

/** PURE: 양의 정수면 그 값, 아니면(미설정·숫자 아님·0 이하) fallback. */
function positiveIntOr(raw: string | undefined, fallback: number): number {
    const n = parseInt(raw || '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 오염 문맥에서도 taint 로 묻지 않는 내장 조회 도구(기본) — 모델이 정하는 입력이 검색어·주장 문장·이름·id 뿐인 읽기성 조회다.
 * 스펙 S3 의 "외부 출력 뒤 쓰기 도구는 승인" 보다 넓게 묻지 않게 한다(검색 2회부터 매번 카드가 뜨는 승인 피로 방지).
 * ⚠️ 모델이 임의의 URL·경로를 넘기는 도구(extract_webpage·web_scrape, image_path 를 받는 vision_ocr·analyze_image 등)는 넣지 않는다 —
 * 오염된 문맥에서는 그 인자가 유출 통로가 된다. 집합에 있어도 도구 자체의 등급이 정책상 승인 대상이면 그대로 묻는다(등급표 불변).
 */
const DEFAULT_TAINT_EXEMPT_TOOLS = ['web_search', 'fact_check', 'load_skill', 'agent_task_list', 'agent_task_get'] as const;

/** PURE: 쉼표 목록 env — 미설정이면 기본, 설정했으면(빈 값 포함) 그 목록으로 바꾼다(빈 값 = 예외 없음). */
export function parseToolNameSet(raw: string | undefined, fallback: readonly string[]): ReadonlySet<string> {
    if (raw === undefined) return new Set(fallback);
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

export const CHAT_TOOL_APPROVAL = {
    /** 채팅 기본 승인 정책 — CHAT_TOOL_APPROVAL_POLICY. 조직 하한(TOOL_APPROVAL_POLICY_MIN)과 더 엄격한 쪽을 쓴다. */
    POLICY: parseApprovalPolicy(process.env.CHAT_TOOL_APPROVAL_POLICY) ?? (isProductionEnv() ? 'high-risk' : 'none'),
    /** 승인 대기 상한(ms) — 넘으면 거절(timeout)로 끝낸다. 대화 중이라 agent-task(30분)보다 짧다. CHAT_TOOL_APPROVAL_TIMEOUT_MS */
    TIMEOUT_MS: positiveIntOr(process.env.CHAT_TOOL_APPROVAL_TIMEOUT_MS, 120_000),
    /** 오염 문맥 판정 — 외부 내용(검색·MCP·브라우저 결과)이 들어온 대화에서 읽기 아닌 도구도 묻는다. CHAT_TOOL_APPROVAL_TAINT */
    TAINT_ENABLED: boolEnvDefault(process.env.CHAT_TOOL_APPROVAL_TAINT, true),
    /** 오염 문맥에서도 taint 로 묻지 않는 도구 — CHAT_TOOL_APPROVAL_TAINT_EXEMPT(쉼표, 설정하면 기본을 대체). 위 DEFAULT_TAINT_EXEMPT_TOOLS 주의 참고 */
    TAINT_EXEMPT_TOOLS: parseToolNameSet(process.env.CHAT_TOOL_APPROVAL_TAINT_EXEMPT, DEFAULT_TAINT_EXEMPT_TOOLS),
} as const;
