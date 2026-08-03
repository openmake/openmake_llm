/**
 * 토론 출처 결정적 첨부 테스트 (2026-08-02).
 *
 * Evidence Package 주입 후에도 최종 답변에 출처 URL 이 0건이었다(라이브 확인).
 * 원인은 채팅 경로와 동일 — 모델이 프롬프트의 인용 지시를 무시한다. 그래서
 * 응답 조립부에서 결정적으로 붙인다.
 */
import {
    buildDiscussionSourcesBlock,
    wrapDiscussionSources,
    extractDiscussionSources,
} from '../discussion-sources';
import type { DiscussionSource } from '../discussion-types';

const SOURCES: DiscussionSource[] = [
    { title: '2026 반도체 수출 규제', url: 'https://example.com/a' },
    { title: 'HBM 공급 현황', url: 'https://example.com/b' },
];

describe('buildDiscussionSourcesBlock', () => {
    it('출처 목록을 마크다운 링크로 만든다', () => {
        const block = buildDiscussionSourcesBlock('토론 결론입니다.', SOURCES, 'ko');
        expect(block).toContain('[2026 반도체 수출 규제](https://example.com/a)');
        expect(block).toContain('[HBM 공급 현황](https://example.com/b)');
    });

    it('중복 URL 은 한 번만 넣는다', () => {
        const dup = [...SOURCES, { title: '중복', url: 'https://example.com/a' }];
        const block = buildDiscussionSourcesBlock('결론', dup, 'ko');
        expect(block.match(/example\.com\/a/g)).toHaveLength(1);
    });

    it('근거가 없으면 아무것도 붙이지 않는다', () => {
        expect(buildDiscussionSourcesBlock('결론', [], 'ko')).toBe('');
        expect(buildDiscussionSourcesBlock('결론', undefined, 'ko')).toBe('');
    });

    it('모델이 이미 출처 섹션을 만들었으면 중복 첨부하지 않는다', () => {
        const answer = '결론입니다.\n\n**출처**\n1. https://example.com/a';
        expect(buildDiscussionSourcesBlock(answer, SOURCES, 'ko')).toBe('');
    });

    it('URL 이 없는 항목은 건너뛴다', () => {
        const block = buildDiscussionSourcesBlock('결론', [{ title: '제목만', url: '' }], 'ko');
        expect(block).toBe('');
    });
});

describe('마커 왕복 (도구 결과 경유)', () => {
    it('감싼 블록을 도구 결과에서 다시 추출하고 모델용 텍스트에서는 제거한다', () => {
        const block = buildDiscussionSourcesBlock('결론', SOURCES, 'ko');
        const toolResult = `참여 전문가: A, B\n\n토론 결론입니다.${wrapDiscussionSources(block)}`;

        const { blocks, modelFacing } = extractDiscussionSources(toolResult);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toContain('example.com/a');
        // 모델에게 가는 텍스트에는 출처·마커가 남지 않아야 한다(요약 대상에서 제외).
        expect(modelFacing).not.toContain('example.com/a');
        expect(modelFacing).not.toContain('discussion-sources');
        expect(modelFacing).toContain('토론 결론입니다.');
    });

    it('마커가 없으면 원문을 그대로 돌려준다', () => {
        const { blocks, modelFacing } = extractDiscussionSources('평범한 도구 결과');
        expect(blocks).toEqual([]);
        expect(modelFacing).toBe('평범한 도구 결과');
    });

    it('빈 블록은 감싸지 않는다', () => {
        expect(wrapDiscussionSources('')).toBe('');
    });
});
