/**
 * OpenAPI 스펙 코어 — 환경 비의존 계약 부분 (paths·components·tags)
 *
 * @module swagger/spec-core
 * @description
 * 런타임 스펙(`swagger.ts` — env 기반 info/servers 부가)과 계약 산출물 export
 * (`scripts/export-openapi.ts` → `packages/api-contracts/openapi.v1.json`)가
 * 공유하는 단일 SoT. 여기에 없는 path 는 계약에도 없다 — 이중 조립 drift 방지.
 * env·config·auth 등 런타임 모듈을 import 하지 않는다 (export 스크립트가 단독 로드).
 */
import { chatPaths } from './paths-chat';
import { platformPaths } from './paths-platform';
import { authPaths } from './paths-auth';
import { sessionPaths } from './paths-sessions';
import { modelPaths } from './paths-models';
import { userAgentPaths } from './paths-user-agents';
import { coreSchemas } from './schemas-core';

/** API 설명 — Swagger UI 와 계약 산출물 공통 */
export const API_DESCRIPTION = `
AI 채팅 어시스턴트 API 문서

## 기능
- 채팅 메시지 전송 및 스트리밍 응답
- 파일 업로드 및 문서 분석
- 클러스터 관리
- 사용자 인증

## 인증
대부분의 API는 JWT 토큰 인증이 필요합니다.
\`Authorization: Bearer <token>\` 헤더를 사용하세요.

## CSRF (비브라우저 클라이언트)
Bearer 헤더 요청은 CSRF 검증에서 면제됩니다. 단 **사전 인증 mutating 요청**
(login/register/refresh)은 \`GET /api/csrf-token\` 으로 토큰을 발급받아
발급 쿠키와 \`X-CSRF-Token\` 헤더를 함께 보내야 합니다 (Double-Submit).
`;

export const specTags = [
    { name: 'Auth', description: '인증 관련 API' },
    { name: 'Chat', description: '채팅 관련 API' },
    { name: 'Documents', description: '문서 업로드 및 분석' },
    { name: 'Knowledge Base', description: 'Knowledge Base 관리 (N:M)' },
    { name: 'Agents', description: 'AI 에이전트 관련 API' },
    { name: 'MCP', description: 'MCP 서버 및 도구 관리' },
    { name: 'Tools', description: '도구 API (웹 검색 등)' },
    { name: 'Cluster', description: '클러스터 관리' },
    { name: 'System', description: '시스템 정보 및 상태' },
    { name: 'API Keys', description: 'API Key 관리 (외부 개발자용)' },
    { name: 'Models', description: '모델 목록' },
    { name: 'User Agents', description: '커스텀 에이전트 (user_agents)' }
];

export const specPaths = {
    ...chatPaths,
    ...platformPaths,
    ...authPaths,
    ...sessionPaths,
    ...modelPaths,
    ...userAgentPaths,
};

export const specComponents = {
    schemas: coreSchemas,
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
};
