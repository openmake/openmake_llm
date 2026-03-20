/**
 * OpenAPI Paths: Cluster, System, Agents, MCP, Tools, Models, KB, API Keys
 */
export const platformPaths = {
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
            summary: 'OpenAI-compatible model list',
            description: 'OpenAI format 모델 목록을 반환합니다. object=list, data[].object=model 구조를 따릅니다.',
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
                                                created: { type: 'integer', example: 1700000000 },
                                                owned_by: { type: 'string', example: 'openmake' },
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
    '/api/kb': {
        post: {
            tags: ['Knowledge Base'],
            summary: 'Create knowledge base',
            description: 'Create a new knowledge base collection',
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['name'],
                            properties: {
                                name: { type: 'string' },
                                description: { type: 'string' },
                                visibility: { type: 'string', enum: ['private', 'team', 'public'] }
                            }
                        }
                    }
                }
            },
            responses: {
                '201': { description: 'Knowledge base created' },
                '400': { description: 'Invalid request' },
                '401': { description: 'Authentication required' }
            }
        },
        get: {
            tags: ['Knowledge Base'],
            summary: 'List knowledge bases',
            description: 'List knowledge base collections available to the user',
            responses: {
                '200': { description: 'Knowledge base list' },
                '401': { description: 'Authentication required' }
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
};
