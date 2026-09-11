import { stripMissingGeneratedLinks, generatedLinkWasCleaned } from '../generated-link-guard';

const exists = (p: string) => p === '/generated/img-old.png';

describe('stripMissingGeneratedLinks — 지어낸 /generated 링크만 제거', () => {
    it('이번 턴 생성분·디스크 존재분은 유지, 나머지는 안내로 대체', () => {
        const content = '![a](/generated/img-new.png)\n\n![b](/generated/img-old.png)\n\n![c](/generated/img-old_east_asian.png) 끝';
        const r = stripMissingGeneratedLinks(content, new Set(['/generated/img-new.png']), exists, 'ko');
        expect(r.removed).toEqual(['/generated/img-old_east_asian.png']);
        expect(r.content).toContain('![a](/generated/img-new.png)');
        expect(r.content).toContain('![b](/generated/img-old.png)');
        expect(r.content).not.toContain('img-old_east_asian');
        expect(r.content).toContain('생성되지 않은 파일 링크를 제거');
    });
    it('일반 링크 형식([듣기](/generated/x.wav))도 대상이고, 다른 경로는 건드리지 않는다', () => {
        const r = stripMissingGeneratedLinks('[듣기](/generated/tts-x.wav) [문서](/docs/a.pdf) https://x/generated/y.png', new Set(), () => false, 'en');
        expect(r.removed).toEqual(['/generated/tts-x.wav']);
        expect(r.content).toContain('[문서](/docs/a.pdf)');
        expect(r.content).toContain('never generated');
    });
    it('제거할 것이 없으면 원문 그대로', () => {
        const c = '설명만 있는 답변';
        expect(stripMissingGeneratedLinks(c, new Set(), () => false)).toEqual({ content: c, removed: [] });
    });
});

describe('generatedLinkWasCleaned', () => {
    it('스트림에 있던 링크가 최종본에서 빠지면 true', () => {
        expect(generatedLinkWasCleaned('![x](/generated/a.png)', '*(제거)*')).toBe(true);
        expect(generatedLinkWasCleaned('![x](/generated/a.png)', '![x](/generated/a.png)')).toBe(false);
        expect(generatedLinkWasCleaned('링크 없음', '링크 없음')).toBe(false);
    });
});
