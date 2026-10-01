/**
 * OpenAPI Paths: Agent Tasks — 에이전트 작업 생성
 *
 * @module swagger/paths-agent-tasks
 * @description `routes/agent-task.routes.ts`(마운트 `/api/agent-tasks`) 중 **생성**만 문서화한다 — 중복 생성 방지 계약
 * (`Idempotency-Key` 헤더, `deduplicated` 응답, 409)을 클라이언트가 알아야 하기 때문이다. 작업 객체는 서버가 컬럼을
 * 그대로 내보내는 열린 형태라 필수 필드만 적는다(나머지 엔드포인트는 라우트 파일 머리말 참고).
 */
import { envelope, failureResponse } from './schemas-core';

const taskSchema = {
    type: 'object',
    required: ['id', 'goal', 'status'],
    additionalProperties: true,
    properties: {
        id: { type: 'string' },
        goal: { type: 'string' },
        status: { type: 'string', description: 'pending · queued · running · paused · completed · failed · cancelled' },
    },
};

const createdSchema = envelope({
    type: 'object',
    required: ['task', 'concurrentActive', 'warnings'],
    properties: {
        task: taskSchema,
        concurrentActive: { type: 'integer', description: '생성 시점에 진행 중이던 이 사용자의 작업 수' },
        warnings: { type: 'array', items: { type: 'string' } },
        deduplicated: {
            type: 'boolean',
            description: '같은 Idempotency-Key 로 이미 만든 작업을 돌려줬다(새로 만들지 않음). 이때 task.status 가 pending 이 아니면 이미 실행이 시작된 것이므로 다시 execute 하지 않는다.',
        },
    },
});

export const agentTaskPaths = {
    '/api/agent-tasks': {
        post: {
            tags: ['Agent Tasks'],
            summary: '에이전트 작업 생성',
            description: '작업을 만든다(실행은 `POST /api/agent-tasks/{taskId}/execute`). '
                + '`Idempotency-Key` 를 보내면 같은 키의 재요청(더블 클릭·네트워크 재전송)은 새로 만들지 않고 처음 만든 작업을 200 으로 돌려준다. '
                + '키는 사용자 단위로 구분되고 서버 재시작·다중 서버에서도 유지된다. multipart/form-data(`payload` JSON + `files`) 도 받는다.',
            security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
            parameters: [
                {
                    name: 'Idempotency-Key',
                    in: 'header',
                    required: false,
                    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$' },
                    description: '클라이언트가 제출마다 새로 만드는 키(UUID 권장). 형식이 맞지 않으면 무시된다(중복 방지 없음).',
                },
            ],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['goal'],
                            properties: {
                                goal: { type: 'string', description: '작업 목표' },
                                maxTurns: { type: 'integer', minimum: 1 },
                                executor: { type: 'string', enum: ['sandbox', 'local'] },
                                deviceId: { type: 'string', description: 'executor=local 일 때 대상 브리지 디바이스' },
                                folderRel: { type: 'string', description: '디바이스 연결 루트 기준 상대경로' },
                                files: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                images: { type: 'array', items: { type: 'string', description: 'data:image/… URL' } },
                            },
                        },
                    },
                },
            },
            responses: {
                '201': { description: '새 작업 생성', content: { 'application/json': { schema: createdSchema } } },
                '200': { description: '같은 Idempotency-Key 의 기존 작업 반환(`deduplicated: true`)', content: { 'application/json': { schema: createdSchema } } },
                '400': failureResponse('검증 실패'),
                '401': failureResponse('인증 필요'),
                '409': failureResponse('같은 Idempotency-Key 의 첫 요청을 아직 처리 중 — 잠시 뒤 같은 키로 다시 보내면 그 작업을 받는다'),
                '429': failureResponse('생성 요청 한도 초과'),
            },
        },
    },
};
