/**
 * ============================================================
 * Marketplace Schema - 마켓플레이스 Zod 검증 스키마
 * ============================================================
 *
 * 마켓플레이스 에이전트 등록 및 리뷰 작성 요청의 유효성을
 * 검증하는 Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/marketplace.schema
 */
import { z } from 'zod';

/**
 * 마켓플레이스 에이전트 등록 스키마
 * @property {string} agentId - 등록할 에이전트 ID (필수)
 * @property {string} title - 마켓플레이스 표시 제목 (필수, 1~100자)
 * @property {string} [description] - 짧은 설명 (500자 이하)
 * @property {string} [longDescription] - 상세 설명 (5000자 이하)
 * @property {string} [category] - 카테고리
 * @property {string[]} [tags] - 태그 배열
 * @property {string} [icon] - 아이콘 URL 또는 이모지
 * @property {number} [price] - 가격 (0 이상)
 */
export const createMarketplaceListingSchema = z.object({
    agentId: z.string().min(1, 'agentId는 필수입니다'),
    title: z.string().min(1, 'title은 필수입니다').max(100),
    description: z.string().max(500).optional(),
    longDescription: z.string().max(5000).optional(),
    category: z.string().max(50).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    icon: z.string().max(500).optional(),
    price: z.number().min(0).optional(),
});

/**
 * 마켓플레이스 리뷰 작성 스키마
 * @property {number} rating - 평점 (1~5 정수, 필수)
 * @property {string} [title] - 리뷰 제목 (200자 이하)
 * @property {string} [content] - 리뷰 내용 (2000자 이하)
 */
export const createReviewSchema = z.object({
    rating: z
        .number({ message: 'rating은 필수입니다' })
        .int('rating은 정수여야 합니다')
        .min(1, 'rating은 1 이상이어야 합니다')
        .max(5, 'rating은 5 이하여야 합니다'),
    title: z.string().max(200).optional(),
    content: z.string().max(2000).optional(),
});

/** 마켓플레이스 등록 요청 TypeScript 타입 */
export type CreateMarketplaceListingInput = z.infer<typeof createMarketplaceListingSchema>;
/** 리뷰 작성 요청 TypeScript 타입 */
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

/**
 * 마켓플레이스 상태 변경 스키마 (관리자: approve/reject/suspend)
 * @property {'pending'|'approved'|'rejected'|'suspended'} status - 변경할 상태 (필수)
 */
export const marketplaceStatusUpdateSchema = z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'suspended'], {
        message: "status는 'pending', 'approved', 'rejected', 'suspended' 중 하나여야 합니다"
    }),
});

/** 마켓플레이스 상태 변경 요청 TypeScript 타입 */
export type MarketplaceStatusUpdateInput = z.infer<typeof marketplaceStatusUpdateSchema>;
