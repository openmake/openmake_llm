/**
 * OpenAPI Paths: Chat REST, Documents, OpenAI-compat
 *
 * (Auth 는 paths-auth.ts, 세션 목록/이력은 paths-sessions.ts 로 분리 —
 *  구 '/api/sessions' 문서는 실존 경로가 아니어서 '/api/chat/sessions' 로 정정 이동, 축 1 Step 2)
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
                                model: { type: 'string', description: 'Model ID (e.g., openmake_llm)' },
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
