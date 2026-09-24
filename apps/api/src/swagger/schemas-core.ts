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
            snippet: { type: 'string', description: '본문 검색(?q=) 매칭 발췌 — 검색 응답에만 존재' },
            folderId: { type: 'string', nullable: true, description: '폴더(157) — null 이면 미분류' },
            tags: { type: 'array', items: { type: 'string' }, description: '태그(157)' }
        }
    },
    ConversationFolder: {
        type: 'object',
        required: ['id', 'name', 'position', 'sessionCount', 'createdAt', 'updatedAt'],
        properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            position: { type: 'integer' },
            sessionCount: { type: 'integer' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' }
        }
    },
    ChatMessage: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
            id: { type: 'string', description: 'DB 메시지 id(정수 문자열) — 이력 조회에만 있으며 "여기서 분기"(clone uptoMessageId) 기준점' },
            role: { type: 'string', enum: ['user', 'assistant', 'system'] },
            content: { type: 'string' },
            model: { type: 'string' },
            tokens: { type: 'integer' },
            images: { type: 'array', items: { type: 'string' }, description: 'dataURL 이미지 목록' },
            created_at: { type: 'string' },
            sources: { type: 'array', items: { $ref: '#/components/schemas/SearchSourceRef' }, description: 'assistant 답변의 웹검색 출처(156) — 본문 [N] 과 같은 번호' }
        }
    },
    SearchSourceRef: {
        type: 'object',
        required: ['n', 'title', 'url', 'snippet'],
        properties: {
            n: { type: 'integer', description: '1부터 — 본문 [N] 번호' },
            title: { type: 'string' },
            url: { type: 'string' },
            snippet: { type: 'string' },
            source: { type: 'string', description: '결과 도메인(표시용)' }
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
    },
    // ── 통합 모델 배정(슬롯) — packages/shared-types/src/model-assignments.ts 계약과 짝 (2026-09-24) ──
    ModelSlotInfo: {
        type: 'object',
        required: ['id', 'group', 'kind', 'roles', 'capabilities', 'paramKeys', 'available'],
        properties: {
            id: { type: 'string' },
            group: { type: 'string', enum: ['agents', 'quality', 'multimodal'] },
            kind: { type: 'string', enum: ['text', 'modality'], description: 'text=채팅 가능 모델 · modality=전체 모델' },
            roles: { type: 'array', items: { type: 'string' }, description: '이 슬롯을 읽는 역할' },
            capabilities: { type: 'array', items: { type: 'string' }, description: '이 슬롯을 읽는 기능' },
            paramKeys: { type: 'array', items: { type: 'string' }, description: '저장 가능한 params 키(없으면 빈 배열)' },
            available: { type: 'boolean', description: '실행 가능 여부 — 어댑터 없음/소유 add-on 꺼짐이면 false' }
        }
    },
    ModelSlotAssignment: {
        type: 'object',
        required: ['slot', 'fullId', 'params', 'updatedAt'],
        properties: {
            slot: { type: 'string' },
            fullId: { type: 'string' },
            params: { type: 'object', additionalProperties: true },
            updatedAt: { type: 'string', format: 'date-time' }
        }
    },
    ModelSlotEffective: {
        type: 'object',
        required: ['slot', 'fullId', 'source'],
        properties: {
            slot: { type: 'string' },
            fullId: { type: 'string', nullable: true, description: '지금 실제로 쓰이는 모델 — 해석 실패면 null' },
            source: { type: 'string', enum: ['user', 'global', 'default', 'none'] },
            error: { type: 'string' },
            code: { type: 'string' }
        }
    },
    ModelAssignmentsResponse: {
        type: 'object',
        required: ['slots', 'assignments', 'effective'],
        properties: {
            slots: { type: 'array', items: { $ref: '#/components/schemas/ModelSlotInfo' } },
            assignments: { type: 'array', items: { $ref: '#/components/schemas/ModelSlotAssignment' } },
            effective: { type: 'array', items: { $ref: '#/components/schemas/ModelSlotEffective' } }
        }
    },
    ModelAssignmentInput: {
        type: 'object',
        required: ['model'],
        properties: {
            model: { type: 'string', description: 'provider:model 또는 로컬 태그' },
            params: { type: 'object', additionalProperties: true }
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
