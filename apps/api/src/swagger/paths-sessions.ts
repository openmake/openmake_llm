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

const folderResponse = (description: string, key: 'folder' | 'folders') => ({
    description,
    content: {
        'application/json': {
            schema: envelope({
                type: 'object',
                required: [key],
                properties: key === 'folders'
                    ? { folders: { type: 'array', items: { $ref: '#/components/schemas/ConversationFolder' } } }
                    : { folder: { $ref: '#/components/schemas/ConversationFolder' } }
            })
        }
    }
});

const folderIdParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '폴더 ID' };

export const sessionPaths = {
    '/api/chat/folders': {
        get: {
            tags: ['Chat'],
            summary: '대화 폴더 목록(157)',
            security: [{ bearerAuth: [] }],
            responses: { '200': folderResponse('성공', 'folders'), '401': failureResponse('인증 필요') }
        },
        post: {
            tags: ['Chat'],
            summary: '대화 폴더 생성(157)',
            security: [{ bearerAuth: [] }],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 64 } } } } } },
            responses: { '201': folderResponse('생성됨', 'folder'), '400': failureResponse('잘못된 입력'), '409': failureResponse('상한 초과 또는 같은 이름') }
        }
    },
    '/api/chat/folders/{id}': {
        patch: {
            tags: ['Chat'],
            summary: '대화 폴더 이름·순서 변경(157)',
            security: [{ bearerAuth: [] }],
            parameters: [folderIdParam],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string', maxLength: 64 }, position: { type: 'integer', minimum: 0 } } } } } },
            responses: { '200': folderResponse('성공', 'folder'), '404': failureResponse('없음'), '409': failureResponse('같은 이름') }
        },
        delete: {
            tags: ['Chat'],
            summary: '대화 폴더 삭제(157) — 안의 세션은 미분류로 남는다',
            security: [{ bearerAuth: [] }],
            parameters: [folderIdParam],
            responses: {
                '200': { description: '삭제됨', content: { 'application/json': { schema: envelope({ type: 'object', required: ['deleted'], properties: { deleted: { type: 'boolean' } } }) } } },
                '404': failureResponse('없음')
            }
        }
    },
    '/api/chat/sessions': {
        get: {
            tags: ['Chat'],
            summary: '세션 목록 조회',
            description: '사용자의 채팅 세션 목록을 조회합니다. `?q=` 지정 시 제목+본문 검색 (결과에 snippet 포함). cursor 페이지네이션 없음 (limit-only).',
            security: [{ bearerAuth: [] }],
            parameters: [
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: '최대 조회 개수' },
                { name: 'q', in: 'query', schema: { type: 'string' }, description: '제목+메시지 본문 검색어' },
                { name: 'folderId', in: 'query', schema: { type: 'string' }, description: '폴더 필터(157) — `none` 이면 미분류' },
                { name: 'tag', in: 'query', schema: { type: 'string' }, description: '태그 필터(157)' }
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
            summary: '세션 제목·폴더·태그 변경',
            description: 'title·folderId·tags 중 보낸 필드만 바꾼다. 폴더·태그(157)는 로그인한 본인 세션만, folderId 는 본인 폴더만(null 이면 미분류로).',
            security: [{ bearerAuth: [] }],
            parameters: [sessionIdParam],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                title: { type: 'string' },
                                folderId: { type: 'string', nullable: true },
                                tags: { type: 'array', items: { type: 'string' }, description: '정규화(소문자·중복 제거·상한) 후 저장' }
                            }
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
    },
    '/api/chat/sessions/{sessionId}/clone': {
        post: {
            tags: ['Chat'],
            summary: '세션 복제(분기)',
            description: '세션을 새 세션으로 복제합니다. `uptoMessageId` 를 주면 그 메시지까지만 복사해 "여기서 분기" 가 됩니다(F08, 2026-09-17). 원본은 바뀌지 않으며 새 세션 metadata 에 parentSessionId/parentMessageId 가 기록됩니다.',
            security: [{ bearerAuth: [] }],
            parameters: [sessionIdParam],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                uptoMessageId: { type: 'integer', description: '이 메시지 id 까지 복사(생략 시 전체)' },
                                title: { type: 'string', description: '새 세션 제목(생략 시 원본 제목 기반)' }
                            }
                        }
                    }
                }
            },
            responses: {
                '201': {
                    description: '복제 성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['session', 'copied'],
                                properties: {
                                    session: {
                                        type: 'object',
                                        required: ['id', 'title', 'parentSessionId'],
                                        properties: {
                                            id: { type: 'string' },
                                            title: { type: 'string' },
                                            parentSessionId: { type: 'string' },
                                            parentMessageId: { type: 'integer', nullable: true }
                                        }
                                    },
                                    copied: { type: 'integer', description: '복사된 메시지 수' }
                                }
                            })
                        }
                    }
                },
                '400': failureResponse('uptoMessageId 형식 오류'),
                '403': failureResponse('접근 권한 없음'),
                '404': failureResponse('세션 없음')
            }
        }
    },
    '/api/chat/sessions/{sessionId}/tree': {
        get: {
            tags: ['Chat'],
            summary: '세션 트리(조상 체인 + 직계 자식)',
            security: [{ bearerAuth: [] }],
            parameters: [sessionIdParam],
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['self', 'ancestors', 'children'],
                                properties: {
                                    self: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } },
                                    ancestors: {
                                        type: 'array', description: '가까운 부모부터',
                                        items: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' }, parentMessageId: { type: 'string', nullable: true } } }
                                    },
                                    children: {
                                        type: 'array',
                                        items: { type: 'object', required: ['id', 'title', 'createdAt'], properties: { id: { type: 'string' }, title: { type: 'string' }, createdAt: { type: 'string' } } }
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
