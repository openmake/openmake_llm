/**
 * ============================================================
 * Chat Schema - 채팅 요청 Zod 검증 스키마
 * ============================================================
 *
 * POST /api/chat 및 POST /api/chat/stream 요청 본문의
 * 유효성을 검증하는 Zod 스키마를 정의합니다.
 *
 * @module schemas/chat.schema
 */
import { z } from 'zod';

/**
 * 대화 히스토리 내 개별 메시지 스키마
 * @property {string} role - 메시지 역할 (user, assistant, system, tool)
 * @property {string} content - 메시지 내용
 */
const chatMessageSchema = z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string()
});

/**
 * 채팅 요청 본문 스키마
 * @property {string} message - 사용자 메시지 (1~100,000자, 필수)
 * @property {Array} [history] - 이전 대화 히스토리
 * @property {string} [model] - 사용할 브랜드 모델 (예: openmake_llm_auto)
 * @property {string} [nodeId] - 특정 클러스터 노드 ID
 * @property {string} [sessionId] - 기존 대화 세션 ID
 * @property {string} [anonSessionId] - 비로그인 사용자 세션 ID
 * @property {string} [docId] - 문서 컨텍스트 ID (문서 Q&A 시)
 * @property {string[]} [images] - Base64 인코딩된 이미지 목록 (Vision 모델용)
 * @property {boolean} [discussionMode] - 다중 모델 토론 모드 활성화
 * @property {boolean} [thinkingMode] - Ollama Native Thinking 활성화
 * @property {string} [thinkingLevel] - 사고 깊이 수준 (low/medium/high)
 * @property {boolean} [webSearch] - 웹 검색 컨텍스트 주입 활성화
 */
export const chatRequestSchema = z.object({
    message: z.string().min(1, '메시지를 입력하세요').max(100000),
    history: z.array(chatMessageSchema).optional(),
    model: z.string().optional(),
    nodeId: z.string().optional(),
    sessionId: z.string().optional(),
    anonSessionId: z.string().optional(),
    docId: z.string().optional(),
    images: z.array(z.string()).optional(),
    discussionMode: z.boolean().optional(),
    thinkingMode: z.boolean().optional(),
    thinkingLevel: z.enum(['low', 'medium', 'high']).optional(),
    webSearch: z.boolean().optional()
});

/** 채팅 요청 TypeScript 타입 (Zod 스키마로부터 추론) */
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
