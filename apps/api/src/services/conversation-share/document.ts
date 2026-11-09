/**
 * 대화 공유 문서 조립 — 원본 행을 내보내지 않고 **allowlist 로 새로 만든다**(설계 §4).
 *
 * 담는 것: 제목, user·assistant 메시지의 role·content. 그 밖의 모든 것(세션·메시지 ID, 모델·에이전트,
 * thinking·reasoningSummary·sources·metadata, system 메시지, 첨부·도구 호출·승인 데이터)은 읽지도 담지도 않는다.
 * 남는 텍스트에는 결정적 정화(redactText)를 적용하지만 완전한 민감정보 탐지기가 아니다 — 안전의 본선은
 * 서버 보관 미리보기 → 사용자 확인 → 그 미리보기 그대로 게시다.
 *
 * PURE — DB 접근 없이 이미 조회된 행을 받아 변환한다.
 *
 * @module services/conversation-share/document
 */
import type { ConversationShareDocumentV1, ConversationShareMessageV1 } from '@openmake/shared-types';
import { redactText } from '../../utils/redact';

/** 입력 행 — role·content 만 읽는다. 다른 필드가 있어도 무시한다. */
export interface ConversationShareSourceMessage {
    role: string;
    content: string | null;
}

const SHARED_ROLES = new Set<ConversationShareMessageV1['role']>(['user', 'assistant']);

export function buildConversationShareDocument(
    title: string | null | undefined,
    messages: readonly ConversationShareSourceMessage[],
): ConversationShareDocumentV1 {
    const out: ConversationShareMessageV1[] = [];
    for (const m of messages) {
        if (!SHARED_ROLES.has(m.role as ConversationShareMessageV1['role'])) continue;
        const content = typeof m.content === 'string' ? m.content : '';
        if (!content.trim()) continue;
        out.push({ role: m.role as ConversationShareMessageV1['role'], content: redactText(content) });
    }
    return { schemaVersion: 1, title: redactText(title ?? ''), messages: out };
}

/** 직렬화한 문서의 UTF-8 바이트 수 — 한도 검사용. */
export function measureConversationShareDocument(doc: ConversationShareDocumentV1): number {
    return Buffer.byteLength(JSON.stringify(doc), 'utf8');
}
