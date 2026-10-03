/**
 * 에이전트 작업 승인(HITL) 보강 설정 — 거절 사유·저장본 가림·자동승인의 바닥·무인 실행의 결론.
 * 승인 정책 자체(all/high-risk/none)와 위험 등급표는 `config/task-sandbox`·`config/tool-policy` 에 있다.
 *
 * @module config/agent-task-approval
 */

/** 거절 사유 상한(자) — 넘으면 앞에서 자른다(거절 자체는 막지 않는다). AGENT_TASK_APPROVAL_REJECT_REASON_MAX_CHARS */
export const APPROVAL_REJECT_REASON_MAX_CHARS = parseInt(process.env.AGENT_TASK_APPROVAL_REJECT_REASON_MAX_CHARS || '', 10) || 500;

/**
 * 승인 저장본(승인함에 보이는 인자·미리보기 사본)의 비밀 값 가림 — 기본 켜짐.
 * 실행과 호출 결속은 원래 인자를 쓰므로 가려도 달라지지 않는다. AGENT_TASK_APPROVAL_REDACT_ARGS=false 로 끈다.
 */
export const APPROVAL_REDACT_STORED_ARGS = process.env.AGENT_TASK_APPROVAL_REDACT_ARGS !== 'false';

/**
 * 자동승인의 바닥 — 작업의 "나머지 모두 승인"에서도 계속 묻는 호출 종류.
 *   credential_write  자격증명 파일(SENSITIVE_FILE_PATTERNS)을 만들거나 고치거나 지우는 호출
 *   third_party_tool  외부 MCP 서버 도구(`server::tool`) — 제3자 코드가 호스트 밖으로 나간다
 * 바닥 검사는 자동승인보다 먼저 돈다. 승인 정책 none(승인 자체가 없음)에는 적용되지 않는다.
 * AGENT_TASK_APPROVAL_FLOOR(쉼표 구분)로 고른다. 빈 값이나 none 이면 바닥 없음(종전 동작).
 */
export const APPROVAL_FLOOR_KINDS = ['credential_write', 'third_party_tool'] as const;
export type ApprovalFloorKind = typeof APPROVAL_FLOOR_KINDS[number];

/** PURE: 환경변수 값 → 바닥 종류. 미지정이면 전부, 모르는 이름은 버린다. */
export function parseApprovalFloorKinds(raw: string | undefined): ApprovalFloorKind[] {
    if (raw === undefined) return [...APPROVAL_FLOOR_KINDS];
    const wanted = new Set(raw.split(',').map((s) => s.trim().toLowerCase()));
    return APPROVAL_FLOOR_KINDS.filter((k) => wanted.has(k));
}

export const APPROVAL_FLOOR: ReadonlySet<ApprovalFloorKind> = new Set(parseApprovalFloorKinds(process.env.AGENT_TASK_APPROVAL_FLOOR));
