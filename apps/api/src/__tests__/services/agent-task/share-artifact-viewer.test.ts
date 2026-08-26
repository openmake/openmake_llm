/**
 * 공유 산출물 뷰어 — pubId 유도·역파싱과 **인덱스 정렬**의 회귀 고정.
 *
 * 인덱스가 어긋나면 A 산출물 링크로 B 본문이 열린다(공유 범위 밖 노출은 아니지만
 * 사용자가 보는 것이 달라진다) — 그래서 문서와 뷰어 콘텐츠는 같은 선별 함수를 봐야 한다.
 */
import { shareViewerPubId, parseShareViewerPubId } from '../../../services/agent-task/share-artifact-viewer';
import { buildShareDocument, extractArtifactViewerContents } from '../../../services/agent-task/share-document';

const SHARE_ID = '66ba7287-b48c-44f8-98ed-37b0e60a951c';

describe('shareViewerPubId', () => {
    test('nginx 경로 패턴([A-Za-z0-9-]+)을 만족한다', () => {
        expect(shareViewerPubId(SHARE_ID, 0)).toMatch(/^[A-Za-z0-9-]+$/);
    });

    test('왕복한다', () => {
        expect(parseShareViewerPubId(shareViewerPubId(SHARE_ID, 3))).toEqual({ shareId: SHARE_ID, index: 3 });
    });

    test('다른 게시본 id 는 이 경로 소관이 아니다', () => {
        expect(parseShareViewerPubId('c0ffee00-1111-2222-3333-444455556666')).toBeNull();
        expect(parseShareViewerPubId('share-')).toBeNull();
        expect(parseShareViewerPubId('share-abc')).toBeNull();       // index 없음
        expect(parseShareViewerPubId('share-abc-x')).toBeNull();     // index 가 수가 아님
    });
});

describe('문서 artifacts ↔ 뷰어 콘텐츠 인덱스 정렬', () => {
    const steps = [
        { step_number: 0, step_type: 'tool_result', content: '무관' },
        { step_number: 1, step_type: 'artifact', content: '{"id":"a","kind":"html","title":"리포트","content":"<h1>A</h1>"}' },
        { step_number: 2, step_type: 'artifact', content: '깨진 JSON' },
        { step_number: 3, step_type: 'artifact', content: '{"id":"c","kind":"markdown","title":"규칙","content":"# C"}' },
    ];

    test('제목 없는/깨진 산출물이 있어도 자리가 밀리지 않는다', () => {
        const doc = buildShareDocument({ id: 't' }, steps);
        const contents = extractArtifactViewerContents(steps);
        expect(doc.artifacts).toHaveLength(3);
        expect(contents).toHaveLength(3);
        expect(doc.artifacts[0].title).toBe('리포트');
        expect(contents[0]).toBe('<h1>A</h1>');
        expect(contents[1]).toBeNull();          // 깨진 JSON — 뷰어 없음
        expect(doc.artifacts[2].title).toBe('규칙');
        expect(contents[2]).toBe('# C');
    });

    test('마크업 본문은 문서엔 없고 뷰어 콘텐츠에만 있다', () => {
        const doc = buildShareDocument({ id: 't' }, steps);
        expect(JSON.stringify(doc)).not.toContain('<h1>A</h1>');
        expect(extractArtifactViewerContents(steps)[0]).toContain('<h1>A</h1>');
    });
});
