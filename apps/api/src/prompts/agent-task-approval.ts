/**
 * 승인(HITL) 결과를 모델에 알리는 문구 — 부모 턴·task 도구·서브에이전트가 같은 문구를 쓴다.
 *
 * @module prompts/agent-task-approval
 */

/**
 * 승인을 받지 못한 호출의 도구 결과.
 * - timeout(무응답): 사용자 부재 — 승인이 필요 없는 길로 마무리하게 한다.
 * - 그 밖(명시 거절·중단): 사용자가 동의하지 않은 것이다. 사유가 있으면 그대로 전하고,
 *   같은 결과를 다른 경로로 얻으려 하지 말라고 한다("다른 방법을 시도"는 우회를 권하는 문구였다).
 */
export function getApprovalRejectedNotice(toolName: string, reason?: string, userReason?: string): string {
    if (reason === 'timeout') {
        return `Error: 승인 대기 시간이 초과되었습니다(무응답, ${toolName}). 사용자가 자리를 비운 것으로 보입니다 — 승인이 필요 없는 방법으로 진행하거나, 지금까지 확보한 결과로 최종 산출물을 작성하세요.`;
    }
    const said = userReason?.trim() ? ` 사용자가 밝힌 사유: "${userReason.trim()}".` : '';
    return `Error: 사용자가 도구 실행을 승인하지 않았습니다 (${toolName}).${said} 사용자는 이 동작에 동의하지 않았습니다 — 같은 호출을 되풀이하거나 인자만 바꿔 다시 요청하지 말고, 같은 결과를 다른 경로(다른 도구·명령)로 얻으려 하지도 마세요. 이 동작 없이 할 수 있는 범위에서 이어가고, 더 진행할 수 없으면 지금까지의 결과로 마무리하세요.`;
}
