/**
 * ============================================================
 * RequestContext — 요청 단위 채팅 컨텍스트
 * ============================================================
 * ChatService 의 요청 스코프 상태(사용자 컨텍스트·활성 도구·실행 계획·skill bindings)를
 * 인스턴스 필드 대신 **명시적으로 전달**하기 위한 객체. processMessageInternal 진입 시
 * 1개 생성되어 도구/전략 해석 메서드로 전달되며, skillBindings 는 흐름 중 채워진다(요청 스코프 mutable).
 *
 * 동기: 인스턴스 필드 보관 시 동시 요청 간 상태 누수 위험 + 거대 메서드 추출 불가.
 *
 * @module services/chat-service/request-context
 */

import type { UserContext } from '../../mcp/user-sandbox';
import type { ExecutionPlan } from '../../chat/profile-resolver';
import type { ActiveSkillBinding } from './tool-merger';

export interface RequestContext {
    /** 사용자 컨텍스트 (도구 접근 권한 결정) */
    userContext: UserContext;
    /** 사용자 원문 메시지 — 의도 인식 도구 노출(특정 MCP 서버 언급 시 depth 우선)용. */
    message?: string;
    /** 사용자가 활성화한 MCP 도구 (undefined면 레거시 모드: 전체 허용) */
    enabledTools?: Record<string, boolean>;
    /** 실행 계획 (requiredTools 강제 포함) */
    executionPlan?: ExecutionPlan;
    /** 활성 skill tool_bindings — agent 선택 직후 채워짐 */
    skillBindings: ActiveSkillBinding[];
}
