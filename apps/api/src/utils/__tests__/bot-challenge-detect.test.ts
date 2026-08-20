/**
 * 봇 챌린지 페이지 판별 — isBotChallengeResult.
 * fetch/Playwright 가 Cloudflare 챌린지("Just a moment...")를 정상 본문으로
 * 반환하던 갭의 판별 로직 검증 (2026-08-20, 임퍼소네이션 폴백 트리거).
 */
import { isBotChallengeResult } from '../web-scraper';

describe('isBotChallengeResult', () => {
    test('Cloudflare 챌린지 제목은 참', () => {
        expect(isBotChallengeResult({ title: 'Just a moment...' })).toBe(true);
        expect(isBotChallengeResult({ title: 'Attention Required! | Cloudflare' })).toBe(true);
        expect(isBotChallengeResult({ title: 'Access denied' })).toBe(true);
    });

    test('일반 문서 제목은 거짓', () => {
        expect(isBotChallengeResult({ title: '로컬 LLM 활용기 - Ai 언어모델 채널' })).toBe(false);
        expect(isBotChallengeResult({ title: '' })).toBe(false);
        expect(isBotChallengeResult({ title: undefined as unknown as string })).toBe(false);
    });
});
