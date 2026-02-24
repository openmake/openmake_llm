/**
 * ============================================================
 * External Schema - 외부 서비스 연결 Zod 검증 스키마
 * ============================================================
 *
 * 외부 서비스 연결 생성, 토큰 갱신, 파일 캐시 요청의 유효성을
 * 검증하는 Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/external.schema
 */
import { z } from 'zod';

const VALID_SERVICE_TYPES = ['google_drive', 'notion', 'github', 'slack', 'dropbox'] as const;

/**
 * 외부 서비스 연결 생성/업데이트 스키마
 * @property {string} serviceType - 서비스 유형 (필수, enum)
 * @property {string} [accessToken] - OAuth 액세스 토큰
 * @property {string} [refreshToken] - OAuth 리프레시 토큰
 * @property {string} [tokenExpiresAt] - 토큰 만료 시각 (ISO8601)
 * @property {string} [accountEmail] - 연결된 계정 이메일
 * @property {string} [accountName] - 연결된 계정 이름
 * @property {object} [metadata] - 서비스별 추가 메타데이터
 */
export const createExternalConnectionSchema = z.object({
    serviceType: z.enum(VALID_SERVICE_TYPES, {
        message: `serviceType은 ${VALID_SERVICE_TYPES.join(', ')} 중 하나여야 합니다`,
    }),
    accessToken: z.string().max(2000).optional(),
    refreshToken: z.string().max(2000).optional(),
    tokenExpiresAt: z.string().datetime({ offset: true }).optional(),
    accountEmail: z.string().email().max(254).optional(),
    accountName: z.string().max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 연결 토큰 갱신 스키마
 * @property {string} accessToken - 새 액세스 토큰 (필수)
 * @property {string} [refreshToken] - 새 리프레시 토큰
 * @property {string} [expiresAt] - 새 만료 시각 (ISO8601)
 */
export const updateExternalTokensSchema = z.object({
    accessToken: z.string().min(1, 'accessToken은 필수입니다').max(2000),
    refreshToken: z.string().max(2000).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
});

/**
 * 외부 파일 캐시 저장 스키마
 * @property {string} externalId - 외부 서비스 파일 ID (필수)
 * @property {string} fileName - 파일 이름 (필수, 500자 이하)
 * @property {string} [fileType] - MIME 타입
 * @property {number} [fileSize] - 파일 크기 (bytes)
 * @property {string} [webUrl] - 외부 서비스 웹 URL
 * @property {string} [cachedContent] - 캐시된 텍스트 내용
 */
export const addExternalFileSchema = z.object({
    externalId: z.string().min(1, 'externalId는 필수입니다').max(500),
    fileName: z.string().min(1, 'fileName은 필수입니다').max(500),
    fileType: z.string().max(100).optional(),
    fileSize: z.number().int().min(0).optional(),
    webUrl: z.string().url().max(2000).optional(),
    cachedContent: z.string().max(1_000_000).optional(),
});

/** 외부 연결 생성 요청 TypeScript 타입 */
export type CreateExternalConnectionInput = z.infer<typeof createExternalConnectionSchema>;
/** 토큰 갱신 요청 TypeScript 타입 */
export type UpdateExternalTokensInput = z.infer<typeof updateExternalTokensSchema>;
/** 외부 파일 캐시 저장 요청 TypeScript 타입 */
export type AddExternalFileInput = z.infer<typeof addExternalFileSchema>;
