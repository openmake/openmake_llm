/**
 * OpenAPI Paths: Chat Sessions — 대화 목록/이력 (iOS MVP 계약 표면)
 *
 * @module swagger/paths-sessions
 * @description
 * `controllers/session.controller.ts` 표면 (마운트 `/api/chat/sessions` —
 * `/api/chat/conversations` 는 동일 컨트롤러 alias 라 계약은 sessions 단일 표기).
 * admin 전용 파라미터(offset·viewAll)·게스트 전용(claim·anonSessionId)은 계약 비노출.
 * 대화 메시지의 영속은 WS(ws-chat-handler)가 수행 — 메시지 저장 REST 는 계약에 없다.
 */
import { envelope, failureResponse } from './schemas-core';

const sessionIdParam = {
    name: 'sessionId',
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: '세션 ID'
};

export const sessionPaths = {
    '/api/chat/sessions': {
        get: {
            tags: ['Chat'],
            summary: '세션 목록 조회',
            description: '사용자의 채팅 세션 목록을 조회합니다. `?q=` 지정 시 제목+본문 검색 (결과에 snippet 포함). cursor 페이지네이션 없음 (limit-only).',
            security: [{ bearerAuth: [] }],
            parameters: [
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: '최대 조회 개수' },
                { name: 'q', in: 'query', schema: { type: 'string' }, description: '제목+메시지 본문 검색어' }
            ],
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['sessions'],
                                properties: {
                                    sessions: {
                                        type: 'array',
                                        items: { $ref: '#/components/schemas/SessionSummary' }
                                    }
                                }
                            })
                        }
                    }
                },
                '401': failureResponse('인증 필요')
            }
        },
        post: {
            tags: ['Chat'],
            summary: '새 세션 생성',
            security: [{ bearerAuth: [] }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                title: { type: 'string', description: '세션 제목 (선택)' },
                                model: { type: 'string', description: '모델 id (선택)' }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': {
                    description: '생성 성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['session'],
                                properties: {
                                    session: {
                                        type: 'object',
                                        required: ['id', 'title', 'createdAt', 'updatedAt'],
                                        properties: {
                                            id: { type: 'string' },
                                            userId: { type: 'string', nullable: true },
                                            anonSessionId: { type: 'string', nullable: true },
                                            title: { type: 'string' },
                                            createdAt: { type: 'string' },
                                            updatedAt: { type: 'string' }
                                        }
                                    }
                                }
                            })
                        }
                    }
                },
                '401': failureResponse('인증 필요')
            }
        }
    },
    '/api/chat/sessions/{sessionId}': {
        patch: {
            tags: ['Chat'],
            summary: '세션 제목 변경',
            security: [{ bearerAuth: [] }],
            parameters: [sessionIdParam],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['title'],
                            properties: { title: { type: 'string' } }
                        }
                    }
                }
            },
            responses: {
                '200': {
                    description: '변경 성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['updated'],
                                properties: { updated: { type: 'boolean' } }
                            })
                        }
                    }
                },
                '403': failureResponse('접근 권한 없음')
            }
        },
        delete: {
            tags: ['Chat'],
            summary: '세션 삭제',
            security: [{ bearerAuth: [] }],
            parameters: [sessionIdParam],
            responses: {
                '200': {
                    description: '삭제 성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['deleted'],
                                properties: { deleted: { type: 'boolean' } }
                            })
                        }
                    }
                },
                '403': failureResponse('접근 권한 없음')
            }
        }
    },
    '/api/chat/sessions/{sessionId}/messages': {
        get: {
            tags: ['Chat'],
            summary: '세션 메시지 이력 조회',
            security: [{ bearerAuth: [] }],
            parameters: [
                sessionIdParam,
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 }, description: '최대 조회 개수' }
            ],
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['messages'],
                                properties: {
                                    messages: {
                                        type: 'array',
                                        items: { $ref: '#/components/schemas/ChatMessage' }
                                    }
                                }
                            })
                        }
                    }
                },
                '403': failureResponse('접근 권한 없음')
            }
        }
    }
};
