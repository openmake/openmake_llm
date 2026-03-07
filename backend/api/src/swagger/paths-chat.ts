/**
 * OpenAPI Paths: Chat, Auth, Documents, Sessions
 */
export const chatPaths = {
    '/api/chat': {
        post: {
            tags: ['Chat'],
            summary: '채팅 메시지 전송',
            description: 'AI에게 메시지를 전송하고 응답을 받습니다.',
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['message'],
                            properties: {
                                message: {
                                    type: 'string',
                                    description: '사용자 메시지'
                                },
                                model: {
                                    type: 'string',
                                    description: '사용할 모델',
                                    default: 'default'
                                },
                                memory: {
                                    type: 'array',
                                    description: '대화 히스토리',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            role: { type: 'string' },
                                            content: { type: 'string' }
                                        }
                                    }
                                },
                                webSearch: {
                                    type: 'boolean',
                                    description: '웹 검색 활성화',
                                    default: false
                                },
                                thinking: {
                                    type: 'boolean',
                                    description: 'Sequential Thinking 활성화',
                                    default: true
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    response: { type: 'string' },
                                    model: { type: 'string' },
                                    tokensUsed: { type: 'integer' }
                                }
                            }
                        }
                    }
                },
                '400': { description: '잘못된 요청' },
                '401': { description: '인증 필요' },
                '500': { description: '서버 오류' }
            }
        }
    },
    '/api/upload': {
        post: {
            tags: ['Documents'],
            summary: '파일 업로드',
            description: '문서 파일을 업로드하고 분석합니다.',
            requestBody: {
                required: true,
                content: {
                    'multipart/form-data': {
                        schema: {
                            type: 'object',
                            properties: {
                                file: {
                                    type: 'string',
                                    format: 'binary',
                                    description: '업로드할 파일'
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': {
                    description: '업로드 성공',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    documentId: { type: 'string' },
                                    filename: { type: 'string' },
                                    textLength: { type: 'integer' }
                                }
                            }
                        }
                    }
                },
                '413': { description: '파일 크기 초과' },
                '415': { description: '지원하지 않는 파일 형식' }
            }
        }
    },
    '/api/auth/login': {
        post: {
            tags: ['Auth'],
            summary: '로그인',
            description: '이메일과 비밀번호로 로그인합니다.',
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['email', 'password'],
                            properties: {
                                email: { type: 'string', format: 'email' },
                                password: { type: 'string', minLength: 6 }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': {
                    description: '로그인 성공',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    token: { type: 'string' },
                                    user: {
                                        type: 'object',
                                        properties: {
                                            id: { type: 'string' },
                                            email: { type: 'string' },
                                            role: { type: 'string' }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                '401': { description: '인증 실패' }
            }
        }
    },
    '/api/auth/register': {
        post: {
            tags: ['Auth'],
            summary: '회원가입',
            description: '새로운 사용자 계정을 생성합니다.',
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['email', 'password'],
                            properties: {
                                email: { type: 'string', format: 'email', description: '이메일 주소' },
                                password: { type: 'string', minLength: 8, description: '비밀번호 (8자 이상, 대소문자/숫자/특수문자 포함)' }
                            }
                        }
                    }
                }
            },
            responses: {
                '201': {
                    description: '회원가입 성공',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    success: { type: 'boolean' },
                                    user: {
                                        type: 'object',
                                        properties: {
                                            id: { type: 'integer' },
                                            email: { type: 'string' },
                                            role: { type: 'string' }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                '400': { description: '잘못된 요청 (유효성 검사 실패)' },
                '409': { description: '이미 존재하는 이메일' }
            }
        }
    },
    '/api/auth/logout': {
        post: {
            tags: ['Auth'],
            summary: '로그아웃',
            description: '현재 토큰을 무효화하고 로그아웃합니다.',
            security: [{ bearerAuth: [] }],
            responses: {
                '200': {
                    description: '로그아웃 성공',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    success: { type: 'boolean' },
                                    message: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                '401': { description: '인증 필요' }
            }
        }
    },
    '/api/auth/me': {
        get: {
            tags: ['Auth'],
            summary: '현재 사용자 정보',
            description: '인증된 사용자의 정보를 조회합니다.',
            security: [{ bearerAuth: [] }],
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    id: { type: 'integer' },
                                    email: { type: 'string' },
                                    role: { type: 'string', enum: ['admin', 'user', 'guest'] },
                                    tier: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
                                    is_active: { type: 'boolean' },
                                    created_at: { type: 'string', format: 'date-time' }
                                }
                            }
                        }
                    }
                },
                '401': { description: '인증 필요' }
            }
        }
    },
    '/api/sessions': {
        get: {
            tags: ['Chat'],
            summary: '세션 목록 조회',
            description: '사용자의 채팅 세션 목록을 조회합니다.',
            security: [{ bearerAuth: [] }],
            parameters: [
                {
                    name: 'limit',
                    in: 'query',
                    schema: { type: 'integer', default: 50 },
                    description: '최대 조회 개수'
                },
                {
                    name: 'offset',
                    in: 'query',
                    schema: { type: 'integer', default: 0 },
                    description: '시작 위치'
                }
            ],
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    sessions: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                id: { type: 'string' },
                                                title: { type: 'string' },
                                                created_at: { type: 'string', format: 'date-time' },
                                                updated_at: { type: 'string', format: 'date-time' },
                                                message_count: { type: 'integer' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        post: {
            tags: ['Chat'],
            summary: '새 세션 생성',
            description: '새로운 채팅 세션을 생성합니다.',
            security: [{ bearerAuth: [] }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                title: { type: 'string', description: '세션 제목 (선택)' }
                            }
                        }
                    }
                }
            },
            responses: {
                '201': {
                    description: '세션 생성 성공',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    title: { type: 'string' },
                                    created_at: { type: 'string', format: 'date-time' }
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    '/api/sessions/{sessionId}': {
        get: {
            tags: ['Chat'],
            summary: '세션 상세 조회',
            description: '특정 채팅 세션의 메시지들을 조회합니다.',
            security: [{ bearerAuth: [] }],
            parameters: [
                {
                    name: 'sessionId',
                    in: 'path',
                    required: true,
                    schema: { type: 'string' },
                    description: '세션 ID'
                }
            ],
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    session: {
                                        type: 'object',
                                        properties: {
                                            id: { type: 'string' },
                                            title: { type: 'string' },
                                            messages: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    properties: {
                                                        role: { type: 'string' },
                                                        content: { type: 'string' },
                                                        created_at: { type: 'string', format: 'date-time' }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                '404': { description: '세션을 찾을 수 없음' }
            }
        },
        delete: {
            tags: ['Chat'],
            summary: '세션 삭제',
            description: '특정 채팅 세션을 삭제합니다.',
            security: [{ bearerAuth: [] }],
            parameters: [
                {
                    name: 'sessionId',
                    in: 'path',
                    required: true,
                    schema: { type: 'string' },
                    description: '세션 ID'
                }
            ],
            responses: {
                '200': { description: '삭제 성공' },
                '404': { description: '세션을 찾을 수 없음' }
            }
        }
    },
    '/api/v1/chat/completions': {
        post: {
            tags: ['Chat'],
            summary: 'OpenAI-compatible chat completions',
            description: 'OpenAI Python SDK compatible endpoint. Supports streaming (SSE) and non-streaming responses.',
            security: [{ apiKeyAuth: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['model', 'messages'],
                            properties: {
                                model: { type: 'string', description: 'Model ID (e.g., openmake_llm, openmake_llm_pro)' },
                                messages: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                                            content: { type: 'string' }
                                        }
                                    }
                                },
                                stream: { type: 'boolean', default: false },
                                temperature: { type: 'number' },
                                max_tokens: { type: 'integer' },
                                tools: { type: 'array', items: { type: 'object' } },
                                tool_choice: { type: 'string' }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': { description: 'Chat completion response (OpenAI format)' },
                '400': { description: 'Invalid request' },
                '401': { description: 'API Key required' }
            }
        }
    }
};
