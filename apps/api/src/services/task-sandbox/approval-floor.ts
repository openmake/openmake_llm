/**
 * 자동승인의 바닥 — PURE.
 *
 * 작업의 "나머지 모두 승인"은 질문 도구만 빼고 전부 통과시켰다. 자격증명 파일 쓰기와 외부 MCP 도구처럼
 * 한 번의 통과가 되돌리기 어려운 호출은 전체 허용에서도 계속 묻는다. 어떤 종류를 바닥으로 둘지는
 * `config/agent-task-approval` 의 APPROVAL_FLOOR.
 *
 * ⚠️ 휴리스틱이다. 파일 도구의 대상 경로만 본다 — 셸(bash·python_execute)로 같은 파일을 쓰는 것은 여기서 걸리지 않는다.
 *
 * @module services/task-sandbox/approval-floor
 */
import { APPROVAL_FLOOR, type ApprovalFloorKind } from '../../config/agent-task-approval';
import { isThirdPartyTool } from '../../config/tool-policy';
import { isSensitivePath } from './sensitive-paths';

/** 파일을 바꾸는 작업 — 도구별 인자 이름과 값. */
const FILE_WRITE_OPS = new Set(['write', 'delete']);
const EDITOR_WRITE_COMMANDS = new Set(['create', 'str_replace', 'insert']);

/** PURE: 파일을 바꾸는 호출이면 그 대상 경로. 읽기·다른 도구·경로 없음은 null. */
export function writeTargetPath(toolName: string, args: Record<string, unknown>): string | null {
    const writes = toolName === 'file_ops' ? FILE_WRITE_OPS.has(String(args.op))
        : toolName === 'str_replace_editor' ? EDITOR_WRITE_COMMANDS.has(String(args.command))
            : false;
    return writes && typeof args.path === 'string' && args.path ? args.path : null;
}

/** PURE: 이 호출이 자동승인에서도 물어야 하는 바닥 호출이면 그 종류, 아니면 null. */
export function approvalFloorReason(toolName: string, args: Record<string, unknown>): ApprovalFloorKind | null {
    if (APPROVAL_FLOOR.has('third_party_tool') && isThirdPartyTool(toolName)) return 'third_party_tool';
    const target = writeTargetPath(toolName, args);
    if (target !== null && APPROVAL_FLOOR.has('credential_write') && isSensitivePath(target)) return 'credential_write';
    return null;
}
