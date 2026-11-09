/**
 * 대화 공유 입력 검증 (198). 알 수 없는 키는 거절한다(strict) — 클라이언트가 snapshot·소유자·범위를 덮어쓰지 못하게.
 *
 * @module schemas/conversation-share.schema
 */
import { z } from 'zod';
import { CONVERSATION_SHARE_VISIBILITIES } from '@openmake/shared-types';

const visibility = z.enum(CONVERSATION_SHARE_VISIBILITIES as unknown as ['private', 'authenticated', 'link', 'org']);

/** 미리보기 — org 일 때만 orgId 필수, 그 밖에는 금지. */
export const conversationSharePreviewSchema = z.object({
    visibility: visibility.optional(),
    orgId: z.string().min(1).max(128).optional(),
}).strict().superRefine((v, ctx) => {
    if (v.visibility === 'org' && !v.orgId) ctx.addIssue({ code: 'custom', path: ['orgId'], message: 'org 범위에는 orgId 가 필요합니다' });
    if (v.visibility !== 'org' && v.orgId !== undefined) ctx.addIssue({ code: 'custom', path: ['orgId'], message: 'orgId 는 org 범위에서만 보냅니다' });
});

/** 게시 — 서버 보관 미리보기 ID 와 명시 확인만. */
export const conversationSharePublishSchema = z.object({
    previewId: z.string().uuid(),
    confirmed: z.literal(true),
}).strict();
