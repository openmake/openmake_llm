/**
 * ============================================================
 * Swagger/OpenAPI - API 문서 자동 생성 및 Swagger UI 제공
 * ============================================================
 *
 * OpenAPI 3.0 스펙을 정의하고 Swagger UI를 통해 인터랙티브 API 문서를 제공합니다.
 * /api/openapi.json 엔드포인트로 JSON 스펙을, /api-docs로 Swagger UI를 서빙합니다.
 *
 * @module swagger
 * @description 제공하는 라우트:
 * - GET /api/openapi.json - OpenAPI 3.0 JSON 스펙
 * - GET /api-docs         - Swagger UI 인터랙티브 문서
 *
 * @description 문서화된 API 태그:
 * - Auth, Chat, Documents, Agents, MCP, Tools, Cluster, System, API Keys, Models
 *
 * @requires config/env - 서버 포트 및 Swagger 베이스 URL 설정
 */

import { Application } from 'express';
import * as path from 'path';
import { getConfig } from './config/env';

/**
 * OpenAPI 3.0 스펙 객체
 * 전체 REST API 엔드포인트의 경로, 요청/응답 스키마, 인증 방식을 정의합니다.
 * /api/openapi.json 엔드포인트에서 JSON으로 서빙됩니다.
 */
export const openApiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'OpenMake.Ai API',
        description: `
AI 채팅 어시스턴트 API 문서

## 기능
- 채팅 메시지 전송 및 스트리밍 응답
- 파일 업로드 및 문서 분석
- 클러스터 관리
- 사용자 인증

## 인증
대부분의 API는 JWT 토큰 인증이 필요합니다.
\`Authorization: Bearer <token>\` 헤더를 사용하세요.
        `,
        version: '1.6.0',
        contact: {
            name: 'API Support',
            email: 'support@example.com'
        }
    },
    servers: [
        {
            url: getConfig().swaggerBaseUrl || `http://localhost:${getConfig().port}`,
            description: '개발 서버'
        }
    ],
    tags: [
        { name: 'Auth', description: '인증 관련 API' },
        { name: 'Chat', description: '채팅 관련 API' },
        { name: 'Documents', description: '문서 업로드 및 분석' },
        { name: 'Agents', description: 'AI 에이전트 관련 API' },
        { name: 'MCP', description: 'MCP 서버 및 도구 관리' },
        { name: 'Tools', description: '도구 API (웹 검색 등)' },
        { name: 'Cluster', description: '클러스터 관리' },
        { name: 'System', description: '시스템 정보 및 상태' },
        { name: 'API Keys', description: 'API Key 관리 (외부 개발자용)' },
        { name: 'Models', description: 'Brand Model 목록' }
    ],
    paths: {
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
        '/api/cluster/status': {
            get: {
                tags: ['Cluster'],
                summary: '클러스터 상태 조회',
                description: '모든 클러스터 노드의 상태를 조회합니다.',
                responses: {
                    '200': {
                        description: '성공',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        nodes: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    id: { type: 'string' },
                                                    name: { type: 'string' },
                                                    status: { type: 'string', enum: ['online', 'offline'] },
                                                    latency: { type: 'integer' }
                                                }
                                            }
                                        },
                                        stats: {
                                            type: 'object',
                                            properties: {
                                                totalNodes: { type: 'integer' },
                                                onlineNodes: { type: 'integer' }
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
        '/api/metrics': {
            get: {
                tags: ['System'],
                summary: '시스템 메트릭 조회',
                description: '시스템 성능 메트릭을 조회합니다.',
                responses: {
                    '200': {
                        description: '성공',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        chat: {
                                            type: 'object',
                                            properties: {
                                                totalRequests: { type: 'integer' },
                                                avgResponseTime: { type: 'number' },
                                                totalTokens: { type: 'integer' }
                                            }
                                        },
                                        system: {
                                            type: 'object',
                                            properties: {
                                                uptime: { type: 'number' },
                                                memoryUsage: { type: 'object' }
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
        '/api/model': {
            get: {
                tags: ['System'],
                summary: '현재 모델 정보',
                description: '현재 사용 중인 AI 모델 정보를 조회합니다.',
                responses: {
                    '200': {
                        description: '성공',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        model: { type: 'string' },
                                        provider: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
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
        '/api/agents': {
            get: {
                tags: ['Agents'],
                summary: '에이전트 목록',
                description: '사용 가능한 AI 에이전트 목록을 조회합니다.',
                responses: {
                    '200': {
                        description: '성공',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        agents: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    type: { type: 'string' },
                                                    name: { type: 'string' },
                                                    emoji: { type: 'string' },
                                                    description: { type: 'string' }
                                                }
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
        '/api/mcp/servers': {
            get: {
                tags: ['MCP'],
                summary: 'MCP 서버 목록',
                description: '연결된 MCP 서버 목록을 조회합니다.',
                security: [{ bearerAuth: [] }],
                responses: {
                    '200': {
                        description: '성공',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        servers: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    id: { type: 'string' },
                                                    name: { type: 'string' },
                                                    status: { type: 'string', enum: ['connected', 'disconnected', 'error'] },
                                                    toolCount: { type: 'integer' }
                                                }
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
        '/api/mcp/tools': {
            get: {
                tags: ['MCP'],
                summary: 'MCP 도구 목록',
                description: '사용 가능한 MCP 도구 목록을 조회합니다.',
                security: [{ bearerAuth: [] }],
                responses: {
                    '200': {
                        description: '성공',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        tools: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    name: { type: 'string' },
                                                    description: { type: 'string' },
                                                    inputSchema: { type: 'object' }
                                                }
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
        '/api/web-search': {
            post: {
                tags: ['Tools'],
                summary: '웹 검색',
                description: '웹 검색을 수행합니다.',
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['query'],
                                properties: {
                                    query: { type: 'string', description: '검색어' },
                                    maxResults: { type: 'integer', default: 5, description: '최대 결과 수' }
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
                                        results: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    title: { type: 'string' },
                                                    url: { type: 'string' },
                                                    snippet: { type: 'string' }
                                                }
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
        '/api/v1/models': {
            get: {
                tags: ['Models'],
                summary: 'Brand Model 목록 조회',
                description: '사용 가능한 OpenMake LLM brand model 목록을 반환합니다.',
                responses: {
                    '200': {
                        description: '모델 목록',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        object: { type: 'string', example: 'list' },
                                        data: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    id: { type: 'string', example: 'openmake_llm_auto' },
                                                    object: { type: 'string', example: 'model' },
                                                    name: { type: 'string', example: 'OpenMake LLM' },
                                                    description: { type: 'string' },
                                                    capabilities: { type: 'array', items: { type: 'string' } }
                                                }
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
        '/api/v1/api-keys': {
            post: {
                tags: ['API Keys'],
                summary: '새 API Key 생성',
                description: '새 API Key를 발급합니다. 평문 키는 이 응답에서만 반환됩니다.',
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name'],
                                properties: {
                                    name: { type: 'string', maxLength: 100, description: 'API Key 이름' },
                                    description: { type: 'string', maxLength: 500 },
                                    scopes: { type: 'array', items: { type: 'string' }, default: ['*'] },
                                    allowed_models: { type: 'array', items: { type: 'string' }, default: ['*'] },
                                    rate_limit_tier: { type: 'string', enum: ['free', 'starter', 'standard', 'enterprise'] },
                                    expires_at: { type: 'string', format: 'date-time' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '201': { description: 'API Key 생성 성공 (평문 키 포함)' },
                    '401': { description: '인증 필요' },
                    '429': { description: '키 한도 초과' }
                }
            },
            get: {
                tags: ['API Keys'],
                summary: 'API Key 목록 조회',
                security: [{ bearerAuth: [] }],
                responses: {
                    '200': { description: 'API Key 목록' },
                    '401': { description: '인증 필요' }
                }
            }
        },
        '/api/v1/api-keys/{id}': {
            get: {
                tags: ['API Keys'],
                summary: '단일 API Key 상세',
                security: [{ bearerAuth: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': { description: 'API Key 상세 정보' },
                    '404': { description: '키를 찾을 수 없음' }
                }
            },
            patch: {
                tags: ['API Keys'],
                summary: 'API Key 수정',
                security: [{ bearerAuth: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    description: { type: 'string' },
                                    is_active: { type: 'boolean' },
                                    rate_limit_tier: { type: 'string', enum: ['free', 'starter', 'standard', 'enterprise'] }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: '수정 성공' },
                    '404': { description: '키를 찾을 수 없음' }
                }
            },
            delete: {
                tags: ['API Keys'],
                summary: 'API Key 삭제',
                security: [{ bearerAuth: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '204': { description: '삭제 성공' },
                    '404': { description: '키를 찾을 수 없음' }
                }
            }
        },
        '/api/v1/api-keys/{id}/rotate': {
            post: {
                tags: ['API Keys'],
                summary: 'API Key 순환 (rotate)',
                description: '기존 키를 무효화하고 새 키를 발급합니다.',
                security: [{ bearerAuth: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': { description: '새 평문 키 반환' },
                    '404': { description: '키를 찾을 수 없음' }
                }
            }
        },
        '/api/v1/usage': {
            get: {
                tags: ['API Keys'],
                summary: 'API Key 사용량 요약',
                description: '현재 API Key의 전체 사용량 통계를 반환합니다.',
                security: [{ apiKeyAuth: [] }],
                responses: {
                    '200': { description: '사용량 통계' },
                    '401': { description: 'API Key 인증 필요' }
                }
            }
        },
        '/api/health': {
            get: {
                tags: ['System'],
                summary: '헬스 체크',
                description: '서버 상태를 확인합니다.',
                responses: {
                    '200': {
                        description: '서버 정상',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'ok' },
                                        timestamp: { type: 'string', format: 'date-time' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
            },
            apiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'X-API-Key',
                description: 'API Key (omk_live_...) — X-API-Key 헤더 또는 Authorization: Bearer'
            }
        }
    },
    security: [
        { bearerAuth: [] },
        { apiKeyAuth: [] }
    ]
};

/**
 * Swagger UI HTML 페이지를 생성합니다.
 * swagger-ui-dist CDN을 사용하여 인터랙티브 API 문서 UI를 렌더링합니다.
 * @returns Swagger UI가 포함된 완전한 HTML 문자열
 */
function generateSwaggerHTML(): string {
    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenMake.Ai API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css">
    <style>
        body { margin: 0; background: #1a1a1a; }
        .swagger-ui { max-width: 1400px; margin: 0 auto; }
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info { margin-top: 20px; }
        .swagger-ui .scheme-container { background: #1a1a1a; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
    <script>
        window.onload = function() {
            SwaggerUIBundle({
                url: '/api/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIBundle.SwaggerUIStandalonePreset
                ],
                layout: 'StandaloneLayout',
                defaultModelsExpandDepth: 1,
                docExpansion: 'list'
            });
        };
    </script>
</body>
</html>
    `;
}

/**
 * Express 앱에 Swagger API 문서 라우트를 등록합니다.
 * - GET /api/openapi.json: OpenAPI JSON 스펙 반환
 * - GET /api-docs: Swagger UI HTML 페이지 반환
 * @param app - Express Application 인스턴스
 */
export function setupSwaggerRoutes(app: Application): void {
    // OpenAPI JSON 스펙
    app.get('/api/openapi.json', (req, res) => {
        res.json(openApiSpec);
    });

    // Swagger UI
    app.get('/api-docs', (req, res) => {
        res.send(generateSwaggerHTML());
    });

    console.log('[Swagger] API 문서 라우트 설정 완료: /api-docs');
}
