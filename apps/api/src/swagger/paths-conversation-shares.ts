/**
 * OpenAPI Paths: 대화 읽기 전용 공유 (198)
 *
 * @module swagger/paths-conversation-shares
 * @description `routes/conversation-share.routes.ts`(마운트 `/api`). 타입 원본은 `packages/shared-types/src/conversation-share.ts`.
 * 접근 판정은 서버만 한다. 조회 거절(없음·토큰 오류·비멤버·비로그인)은 모두 같은 404 다.
 */
import { envelope, failureResponse } from './schemas-core';

const visibility = { type: 'string', enum: ['private', 'authenticated', 'link', 'org'] };

const shareDocument = {
    type: 'object',
    required: ['schemaVersion', 'title', 'messages'],
    properties: {
        schemaVersion: { type: 'integer', enum: [1] },
        title: { type: 'string' },
        messages: {
            type: 'array',
            items: {
                type: 'object',
                required: ['role', 'content'],
                properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } },
            },
        },
    },
};

const shareState = {
    type: 'object',
    required: ['shareId', 'visibility', 'orgId', 'revision', 'capturedAt', 'updatedAt', 'path'],
    properties: {
        shareId: { type: 'string' },
        visibility,
        orgId: { type: 'string', nullable: true },
        revision: { type: 'integer' },
        capturedAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        path: { type: 'string', description: '같은 origin 공유 페이지 경로. link 면 `?token=` 포함(소유자 응답에만)' },
    },
};

const sessionIdParam = { name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } };
const security = [{ bearerAuth: [] }];
const tags = ['Conversation Shares'];
const ownerErrors = {
    '401': failureResponse('로그인 필요'),
    '404': failureResponse('없거나 소유하지 않은 대화(관리자도 같다)'),
    '503': failureResponse('DB·감사 기록 실패 — 접근을 허용하지 않는다'),
};

export const conversationSharePaths = {
    '/api/sessions/{sessionId}/share': {
        get: {
            tags, summary: '대화 공유 상태', security, parameters: [sessionIdParam],
            responses: {
                '200': {
                    description: '현재 공유와 서버가 현재 멤버십으로 계산한 선택지',
                    content: { 'application/json': { schema: envelope({
                        type: 'object',
                        required: ['share', 'capabilities'],
                        properties: {
                            share: { ...shareState, nullable: true },
                            capabilities: {
                                type: 'object',
                                required: ['canShare', 'allowedVisibilities', 'organizations'],
                                properties: {
                                    canShare: { type: 'boolean', enum: [true] },
                                    allowedVisibilities: { type: 'array', items: visibility },
                                    organizations: {
                                        type: 'array',
                                        items: { type: 'object', required: ['orgId', 'name'], properties: { orgId: { type: 'string' }, name: { type: 'string' } } },
                                    },
                                },
                            },
                        },
                    }) } },
                },
                ...ownerErrors,
            },
        },
        post: {
            tags, summary: '확인한 미리보기를 게시', security, parameters: [sessionIdParam],
            description: '서버에 보관한 미리보기를 그대로 게시한다. 본문·범위·소유자 override 는 받지 않는다(알 수 없는 키 400).',
            requestBody: {
                required: true,
                content: { 'application/json': { schema: {
                    type: 'object', additionalProperties: false, required: ['previewId', 'confirmed'],
                    properties: { previewId: { type: 'string', format: 'uuid' }, confirmed: { type: 'boolean', enum: [true] } },
                } } },
            },
            responses: {
                '200': { description: '공유 상태', content: { 'application/json': { schema: envelope(shareState) } } },
                '400': failureResponse('확인 누락·잘못된 입력'),
                '409': failureResponse('CONVERSATION_SHARE_PREVIEW_STALE — 미리보기 만료·교체·그 사이 다른 게시'),
                ...ownerErrors,
            },
        },
        delete: {
            tags, summary: '대화 공유 해제(멱등)', security, parameters: [sessionIdParam],
            responses: {
                '200': { description: '해제 결과', content: { 'application/json': { schema: envelope({
                    type: 'object', required: ['unshared'], properties: { unshared: { type: 'boolean' } },
                }) } } },
                ...ownerErrors,
            },
        },
    },
    '/api/sessions/{sessionId}/share/preview': {
        post: {
            tags, summary: '공유 미리보기 생성', security, parameters: [sessionIdParam],
            description: '저장된 user·assistant 메시지의 본문만 담은 문서를 만들어 15분간 보관한다. 첨부·도구·승인·키 정보는 담지 않는다.',
            requestBody: {
                required: false,
                content: { 'application/json': { schema: {
                    type: 'object', additionalProperties: false,
                    properties: { visibility, orgId: { type: 'string', description: 'visibility=org 일 때만 필수' } },
                } } },
            },
            responses: {
                '200': { description: '미리보기', content: { 'application/json': { schema: envelope({
                    type: 'object',
                    required: ['previewId', 'document', 'capturedAt', 'expiresAt', 'visibility', 'orgId', 'baseRevision'],
                    properties: {
                        previewId: { type: 'string', format: 'uuid' },
                        document: shareDocument,
                        capturedAt: { type: 'string', format: 'date-time' },
                        expiresAt: { type: 'string', format: 'date-time' },
                        visibility,
                        orgId: { type: 'string', nullable: true },
                        baseRevision: { type: 'integer' },
                    },
                }) } } },
                '400': failureResponse('잘못된 범위 조합'),
                '413': failureResponse('CONVERSATION_SHARE_TOO_LARGE — 500개 또는 1MiB 초과'),
                '422': failureResponse('CONVERSATION_SHARE_EMPTY — 저장된 메시지 없음'),
                ...ownerErrors,
            },
        },
    },
    '/api/shared-conversations/{shareId}': {
        get: {
            tags, summary: '공유된 대화 조회',
            description: '공유 레코드와 멤버십만 읽는다. org 는 열람자·소유자 모두 현재 멤버여야 한다(관리자·토큰 우회 없음).',
            security: [{}, { bearerAuth: [] }],
            parameters: [
                { name: 'shareId', in: 'path', required: true, schema: { type: 'string' } },
                { name: 'token', in: 'query', required: false, schema: { type: 'string' }, description: 'link 범위 토큰' },
            ],
            responses: {
                '200': { description: '공유 문서', content: { 'application/json': { schema: envelope({
                    type: 'object', required: ['shareId', 'visibility', 'capturedAt', 'updatedAt', 'document'],
                    properties: {
                        shareId: { type: 'string' }, visibility,
                        capturedAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
                        document: shareDocument,
                    },
                }) } } },
                '404': failureResponse('볼 수 없음(사유 구별 없음)'),
                '503': failureResponse('DB·감사 기록 실패'),
            },
        },
    },
};
