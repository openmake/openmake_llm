/**
 * OpenAPI 공통 컴포넌트 — ApiResponse envelope 및 iOS MVP 계약 도메인 스키마
 *
 * @module swagger/schemas-core
 * @description
 * `utils/api-response.ts` 의 success()/error() envelope 과
 * `@openmake/shared-types` 의 계약 타입(PublicUser·ConversationSession·ChatMessage)을
 * OpenAPI components.schemas 로 표현한다. 백엔드 실응답과의 일치는
 * 계약 테스트(express-openapi-validator)가 검증한다 (축 1 Step 4).
 */

/** components.schemas 에 병합되는 공통 스키마 */
export const coreSchemas = {
    ApiMeta: {
        type: 'object',
        required: ['timestamp'],
        properties: {
            timestamp: { type: 'string', format: 'date-time' },
            requestId: { type: 'string' }
        }
    },
    ApiFailure: {
        type: 'object',
        required: ['success', 'error', 'meta'],
        properties: {
            success: { type: 'boolean', enum: [false] },
            error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                    details: {}
                }
            },
            meta: { $ref: '#/components/schemas/ApiMeta' }
        }
    },
    PublicUser: {
        type: 'object',
        required: ['id', 'email', 'role', 'created_at', 'is_active'],
        properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'user', 'guest'] },
            created_at: { type: 'string' },
            last_login: { type: 'string' },
            is_active: { type: 'boolean' }
        }
    },
    SessionSummary: {
        type: 'object',
        required: ['id', 'title', 'createdAt', 'updatedAt', 'messageCount', 'model'],
        properties: {
            id: { type: 'string' },
            userId: { type: 'string', nullable: true },
            anonSessionId: { type: 'string', nullable: true },
            title: { type: 'string' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
            metadata: { type: 'object', nullable: true },
            messageCount: { type: 'integer' },
            model: { type: 'string', description: '첫 메시지의 모델명 (없으면 기본 표시명)' },
            snippet: { type: 'string', description: '본문 검색(?q=) 매칭 발췌 — 검색 응답에만 존재' }
        }
    },
    ChatMessage: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
            role: { type: 'string', enum: ['user', 'assistant', 'system'] },
            content: { type: 'string' },
            model: { type: 'string' },
            tokens: { type: 'integer' },
            images: { type: 'array', items: { type: 'string' }, description: 'dataURL 이미지 목록' },
            created_at: { type: 'string' }
        }
    },
    ModelCapabilities: {
        type: 'object',
        required: ['executionStrategy', 'thinking', 'discussion', 'vision', 'toolCalling', 'streaming'],
        properties: {
            executionStrategy: { type: 'string', enum: ['single'] },
            thinking: { type: 'string', enum: ['off', 'medium'] },
            discussion: { type: 'boolean' },
            vision: { type: 'boolean' },
            toolCalling: { type: 'boolean' },
            streaming: { type: 'boolean' }
        }
    },
    ModelEntry: {
        type: 'object',
        required: ['name', 'modelId', 'description', 'provider', 'capabilities'],
        properties: {
            name: { type: 'string' },
            modelId: { type: 'string', description: 'provider prefix 포함 full model id' },
            description: { type: 'string' },
            provider: { type: 'string' },
            capabilities: { $ref: '#/components/schemas/ModelCapabilities' },
            available: { type: 'boolean', description: 'startup probe 결과 — false 면 UI dimmed' },
            unavailableReason: { type: 'string' },
            isFree: { type: 'boolean' },
            pricing: {
                type: 'object',
                properties: {
                    input: { type: 'number' },
                    output: { type: 'number' }
                }
            }
        }
    },
    UserAgent: {
        type: 'object',
        required: ['id', 'name', 'system_prompt', 'visibility', 'is_active', 'created_at', 'updated_at'],
        properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            system_prompt: { type: 'string' },
            allowed_tools: { type: 'array', items: { type: 'string' } },
            allowed_skills: { type: 'array', items: { type: 'string' } },
            icon: { type: 'string', nullable: true },
            model: { type: 'string', nullable: true, description: '에이전트 전용 모델 fullId (null=상속)' },
            visibility: { type: 'string', enum: ['private', 'shared'] },
            is_active: { type: 'boolean' },
            usage_count: { type: 'integer' },
            created_at: { type: 'string' },
            updated_at: { type: 'string' }
        }
    }
};

/**
 * success() envelope 스키마 생성 — `{ success: true, data, meta }`
 * @param dataSchema data 필드의 OpenAPI 스키마
 */
export function envelope(dataSchema: Record<string, unknown>): Record<string, unknown> {
    return {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
            success: { type: 'boolean', enum: [true] },
            data: dataSchema,
            meta: { $ref: '#/components/schemas/ApiMeta' }
        }
    };
}

/** 표준 에러 응답 (ApiFailure envelope) */
export function failureResponse(description: string): Record<string, unknown> {
    return {
        description,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/ApiFailure' }
            }
        }
    };
}
