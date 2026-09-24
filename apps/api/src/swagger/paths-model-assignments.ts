/**
 * OpenAPI Paths: Model Assignments — 통합 모델 배정(슬롯)
 *
 * @module swagger/paths-model-assignments
 * @description 사용자 `controllers/model-assignments.controller.ts`(마운트 `/api/users/me/model-assignments`) +
 * 관리자 전역 `routes/admin-model-assignments.routes.ts`(마운트 `/api/admin/model-assignments`).
 * 역할별·기능별 모델을 하나의 슬롯 배정으로 합친다(2026-09-24). 스키마는 `packages/shared-types/src/model-assignments.ts` 계약과 짝.
 */
import { envelope, failureResponse } from './schemas-core';

const slotParam = {
    name: 'slot',
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: '슬롯 id (config/model-slots)',
};

const putBody = {
    required: true,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelAssignmentInput' } } },
};

const putResponses = {
    '200': {
        description: '성공',
        content: {
            'application/json': {
                schema: envelope({
                    type: 'object',
                    required: ['assignment'],
                    properties: { assignment: { $ref: '#/components/schemas/ModelSlotAssignment' } },
                }),
            },
        },
    },
    '400': failureResponse('검증 실패(슬롯·모델·키)'),
    '401': failureResponse('인증 필요'),
};

const deleteResponses = {
    '200': {
        description: '성공',
        content: {
            'application/json': {
                schema: envelope({ type: 'object', required: ['deleted'], properties: { deleted: { type: 'boolean' } } }),
            },
        },
    },
    '401': failureResponse('인증 필요'),
    '404': failureResponse('배정 없음'),
};

const listResponse = {
    '200': {
        description: '성공',
        content: {
            'application/json': { schema: envelope({ $ref: '#/components/schemas/ModelAssignmentsResponse' }) },
        },
    },
    '401': failureResponse('인증 필요'),
};

export const modelAssignmentPaths = {
    '/api/users/me/model-assignments': {
        get: {
            tags: ['Model Assignments'],
            summary: '내 모델 배정 목록',
            description: '슬롯 목록 + 본인 배정 + 실효(effective) 해석을 반환합니다.',
            security: [{ bearerAuth: [] }],
            responses: listResponse,
        },
    },
    '/api/users/me/model-assignments/{slot}': {
        put: {
            tags: ['Model Assignments'],
            summary: '슬롯 배정',
            description: 'text 슬롯은 역할 규칙(BYOK·채팅 가능 모델), modality 슬롯은 기능 규칙으로 검증합니다.',
            security: [{ bearerAuth: [] }],
            parameters: [slotParam],
            requestBody: putBody,
            responses: putResponses,
        },
        delete: {
            tags: ['Model Assignments'],
            summary: '슬롯 배정 해제',
            security: [{ bearerAuth: [] }],
            parameters: [slotParam],
            responses: deleteResponses,
        },
    },
    '/api/admin/model-assignments': {
        get: {
            tags: ['Model Assignments'],
            summary: '전역 모델 배정 목록 (admin)',
            description: 'scope=__global__. 슬롯 목록 + 전역 배정 + 전역 티어 실효 해석.',
            security: [{ bearerAuth: [] }],
            responses: listResponse,
        },
    },
    '/api/admin/model-assignments/{slot}': {
        put: {
            tags: ['Model Assignments'],
            summary: '전역 슬롯 배정 (admin)',
            description: '전역은 서버 공용 키 규칙으로 검증. 비배정 슬롯(chat·router)도 허용.',
            security: [{ bearerAuth: [] }],
            parameters: [slotParam],
            requestBody: putBody,
            responses: putResponses,
        },
        delete: {
            tags: ['Model Assignments'],
            summary: '전역 슬롯 배정 해제 (admin)',
            security: [{ bearerAuth: [] }],
            parameters: [slotParam],
            responses: deleteResponses,
        },
    },
};
