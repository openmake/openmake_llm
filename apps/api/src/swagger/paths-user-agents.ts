/**
 * OpenAPI Paths: User Agents — 커스텀 에이전트 선택 목록 (iOS MVP 계약 표면)
 *
 * @module swagger/paths-user-agents
 * @description `controllers/user-agents.controller.ts` (마운트 `/api/users/me/agents`).
 * MVP 계약은 선택용 목록 조회만 — 작성/수정/공유 표면은 2차.
 */
import { envelope, failureResponse } from './schemas-core';

export const userAgentPaths = {
    '/api/users/me/agents': {
        get: {
            tags: ['User Agents'],
            summary: '커스텀 에이전트 목록',
            description: '본인 소유 + 워크스페이스 공유 에이전트 목록을 반환합니다 (타인 user_id 비노출). 채팅에서 `userAgentId` 로 지정하면 산업 에이전트 자동 라우팅을 우회합니다.',
            security: [{ bearerAuth: [] }],
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['agents'],
                                properties: {
                                    agents: {
                                        type: 'array',
                                        items: { $ref: '#/components/schemas/UserAgent' }
                                    }
                                }
                            })
                        }
                    }
                },
                '401': failureResponse('인증 필요')
            }
        }
    }
};
