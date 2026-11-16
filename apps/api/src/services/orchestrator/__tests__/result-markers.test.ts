/**
 * 최종 본문의 오케스트레이터 내부 표식 정리 — 모델이 작업 결과 블록의 머리글 이름·작업 번호를
 * 인용 표식처럼 옮겨 쓴 것(`[오케스트레이터 작업 결과 t1, 결과 6, 8]`, 2026-11-16 라이브)을 지우거나 출처 인용으로 고쳐 쓴다.
 */
import { scrubResultBlockMarkers, resultBlockMarkersWereCleaned } from '../result-markers';

const ko = (content: string, validNums: number[] = []) =>
    scrubResultBlockMarkers(content, { sourceLabel: '출처', validNums: new Set(validNums.map(String)) });

describe('scrubResultBlockMarkers', () => {
    it('번호표에 있는 번호는 출처 인용으로 고쳐 쓴다', () => {
        const r = ko('기온은 5도입니다 [오케스트레이터 작업 결과 t1, 결과 6, 8].', [6, 7, 8]);
        expect(r.content).toBe('기온은 5도입니다 [출처 6, 8].');
        expect(r.removed).toBe(1);
    });

    it('번호표가 없는 턴은 삭제한다(앞 공백 1개 포함)', () => {
        expect(ko('기온은 5도입니다 [오케스트레이터 작업 결과 t1, 결과 6, 8].').content).toBe('기온은 5도입니다.');
    });

    it('숫자가 인용 꼴이 아니면(작업 수·건수) 삭제한다', () => {
        expect(ko('완료 [오케스트레이터 작업 결과 2건 완료]', [2]).content).toBe('완료');
        expect(scrubResultBlockMarkers('Done [Orchestrator task results: 3 tasks]', { sourceLabel: 'Source', validNums: new Set(['3']) }).content).toBe('Done');
    });

    it('번호표 안·밖 번호가 섞이면 안쪽 번호만 남기고, 하나도 없으면 삭제한다', () => {
        expect(ko('a [오케스트레이터 작업 결과 출처 6, 40]', [6]).content).toBe('a [출처 6]');
        expect(ko('a [오케스트레이터 작업 결과 출처 40, 41]', [6]).content).toBe('a');
    });

    it('영어 표식·대소문자 무시', () => {
        const r = scrubResultBlockMarkers('Sunny [orchestrator TASK results t1, result 3].', { sourceLabel: 'Source', validNums: new Set(['3']) });
        expect(r.content).toBe('Sunny [Source 3].');
    });

    it('전각 괄호도 같은 규칙', () => {
        expect(ko('맑음 【오케스트레이터 작업 결과 t1, 결과 6】', [6]).content).toBe('맑음 [출처 6]');
        expect(ko('맑음 【오케스트레이터 작업 결과】').content).toBe('맑음');
    });

    it('블록 이름 없이 작업 번호 머리줄만 옮긴 꼴도 덮는다', () => {
        expect(ko('비 [t1 · web.search] 옴').content).toBe('비 옴');
        expect(ko('비 [t1 결과 6, 8] 옴', [6, 8]).content).toBe('비 [출처 6, 8] 옴');
    });

    it('작업 번호는 단어 경계로만 본다', () => {
        expect(ko('[st1 결과 표] 그대로').content).toBe('[st1 결과 표] 그대로');
    });

    it('일반 대괄호·출처 인용·링크·코드는 건드리지 않는다', () => {
        const s = '근거 [출처 3]. 배열 arr[1]. [문서](https://e.x) [참고] 끝';
        expect(ko(s, [3]).content).toBe(s);
        expect(ko(s, [3]).removed).toBe(0);
    });

    it('코드펜스·인라인 코드 안은 보존한다', () => {
        const s = '```\n[오케스트레이터 작업 결과 t1]\n```\n`[t1 · web.search]` 끝 [오케스트레이터 작업 결과]';
        expect(ko(s).content).toBe('```\n[오케스트레이터 작업 결과 t1]\n```\n`[t1 · web.search]` 끝');
    });
});

describe('scrubResultBlockMarkers — 새 블록 이름', () => {
    it('새 이름도 같은 규칙으로 정리한다(옛 이름 사례는 위에서 그대로 통과)', () => {
        expect(ko('맑음 [사전 작업 결과 출처 16, 18].', [16, 18]).content).toBe('맑음 [출처 16, 18].');
        expect(scrubResultBlockMarkers('Done [Prepared task results 3 tasks]', { sourceLabel: 'Source', validNums: new Set(['3']) }).content).toBe('Done');
    });
});

describe('resultBlockMarkersWereCleaned', () => {
    it('스트리밍 본문에 있던 표식이 최종본에 없으면 true', () => {
        expect(resultBlockMarkersWereCleaned('a [오케스트레이터 작업 결과 t1, 결과 6]', 'a [출처 6]')).toBe(true);
        expect(resultBlockMarkersWereCleaned('a 【오케스트레이터 작업 결과】', 'a')).toBe(true);
        expect(resultBlockMarkersWereCleaned('a [t1 · web.search]', 'a')).toBe(true);
    });

    it('표식이 없던 본문·정리되지 않은 본문은 false', () => {
        expect(resultBlockMarkersWereCleaned('a [출처 6]', 'a [출처 6]')).toBe(false);
        expect(resultBlockMarkersWereCleaned('a [Orchestrator task results]', 'a [Orchestrator task results]')).toBe(false);
    });
});
