/**
 * 비교 매트릭스 프롬프트 variant (F26.1) — L2. 셀 = (모델 × variant), variant 는 채팅 요청 필드만 바꾼다
 * (운영 경로 그대로 — 평가 전용 분기를 코드에 심지 않는다).
 *
 * @module evaluation/matrix-variants
 */
import type { ChatMessageRequest } from '../services/chat-service-types';

export interface MatrixVariant {
    description: string;
    request: Partial<ChatMessageRequest>;
}

export const MATRIX_VARIANTS: Readonly<Record<string, MatrixVariant>> = {
    base: { description: '기본 스타일', request: {} },
    concise: { description: '간결 스타일(style=concise)', request: { style: 'concise' } },
    verbose: { description: '상세 스타일(style=verbose)', request: { style: 'verbose' } },
    thinking: { description: 'Thinking 모드(medium)', request: { thinkingMode: true, thinkingLevel: 'medium' } },
};

export const MATRIX_DEFAULT_VARIANTS = ['base', 'concise'] as const;
