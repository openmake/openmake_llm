/**
 * OpenAPI Paths: Models — 모델 카탈로그 (iOS MVP 계약 표면)
 *
 * @module swagger/paths-models
 * @description `routes/model.routes.ts` 의 `GET /api/models`.
 * 단수형 `GET /api/model` 은 중복 표면이라 계약 비노출 (paths-platform 의 기존 문서만 잔존).
 */
import { envelope, failureResponse } from './schemas-core';

export const modelPaths = {
    '/api/models': {
        get: {
            tags: ['Models'],
            summary: '사용 가능 모델 목록',
            description: '로컬 모델 카탈로그(기본 모델이 첫 entry) + 인증 사용자의 외부 provider 등록 모델을 반환합니다. 비인증도 로컬 카탈로그는 조회 가능.',
            security: [{ bearerAuth: [] }, {}],
            parameters: [
                {
                    name: 'usableOnly',
                    in: 'query',
                    schema: { type: 'string', enum: ['1'] },
                    description: '1 이면 역할 배정 가능(streaming+toolCalling) 모델만 반환'
                }
            ],
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['defaultModel', 'models'],
                                properties: {
                                    defaultModel: { type: 'string', description: '기본 chat 모델 full id' },
                                    models: {
                                        type: 'array',
                                        items: { $ref: '#/components/schemas/ModelEntry' }
                                    },
                                    imageModel: {
                                        type: 'string',
                                        nullable: true,
                                        description: '이미지 생성 모델 id (미설정 시 null)'
                                    }
                                }
                            })
                        }
                    }
                },
                '500': failureResponse('모델 카탈로그 조회 실패')
            }
        }
    }
};
