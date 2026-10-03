/**
 * 승인 요청의 "보이는 사본" 가림 — PURE.
 *
 * 승인 행의 인자·미리보기는 승인함에 그대로 보이고, 이관·에스컬레이션하면 다른 조직원이 본다.
 * 실행은 체크포인트의 원래 호출에서 오고 호출 결속은 원래 인자의 해시(args_hash)라, 사본을 가려도
 * 실행·재시작 이어받기에는 영향이 없다(테스트가 고정).
 *
 * - 민감 키(password·token·secret·key·auth …)의 값: 스텝 기록과 같은 기준(`agent-task/tool-args`).
 * - 그 밖의 문자열 값에 섞인 자격증명(셸 명령·파일 본문): `utils/redact` 의 값 패턴.
 * - 질문 도구(ask_human·mcp_elicit)는 키를 가리지 않는다 — 입력 양식의 필드 이름이 민감 키와 겹쳐 양식이 깨진다.
 *
 * @module services/task-sandbox/approval-redact
 */
import { maskSensitiveKeys } from '../agent-task/tool-args';
import { redactSecrets } from '../../utils/redact';
import { HITL_ALWAYS_WAIT_TOOLS } from '../../config/tool-policy';
import { APPROVAL_REDACT_STORED_ARGS } from '../../config/agent-task-approval';

function redactStrings(value: unknown): unknown {
    if (typeof value === 'string') return redactSecrets(value);
    if (Array.isArray(value)) return value.map(redactStrings);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactStrings(v)]));
    }
    return value;
}

/** 승인함에 보일 인자 사본. 원래 객체는 바꾸지 않는다. 가림에 실패하면 원문 대신 표식만 남긴다(fail-closed). */
export function redactApprovalArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    if (!APPROVAL_REDACT_STORED_ARGS) return args;
    try {
        const keyed = HITL_ALWAYS_WAIT_TOOLS.has(toolName) ? args : maskSensitiveKeys(args);
        return redactStrings(keyed) as Record<string, unknown>;
    } catch {
        return { _redacted: true };
    }
}

/** 승인 카드 미리보기(diff·절차 본문)에 섞인 자격증명 값 가림. */
export function redactApprovalPreview(preview: string | undefined): string | undefined {
    return preview && APPROVAL_REDACT_STORED_ARGS ? redactSecrets(preview) : preview;
}
