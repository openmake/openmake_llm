/**
 * API Documentation with Swagger/OpenAPI
 * API 문서 자동 생성 및 Swagger UI 제공
 */

import { Application } from 'express';
import * as path from 'path';

// OpenAPI 3.0 스펙
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
        version: '1.5.0',
        contact: {
            name: 'API Support',
            email: 'support@example.com'
        }
    },
    servers: [
        {
            url: process.env.SWAGGER_BASE_URL || `http://localhost:${process.env.PORT || 52416}`,
            description: '개발 서버'
        }
    ],
    tags: [
        { name: 'Chat', description: '채팅 관련 API' },
        { name: 'Documents', description: '문서 업로드 및 분석' },
        { name: 'Auth', description: '인증 관련 API' },
        { name: 'Cluster', description: '클러스터 관리' },
        { name: 'System', description: '시스템 정보' }
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
        }
    },
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
            }
        }
    },
    security: [
        { bearerAuth: [] }
    ]
};

/**
 * Swagger UI HTML 생성
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
 * API 문서 라우트 설정
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
