/**
 * 워크스페이스 셸·채팅 스크롤 영역은 absolute 자손의 기준(positioned) 블록이어야 한다.
 * apps/web 에는 테스트 러너가 없어 소스의 className 을 정적으로 확인한다.
 *
 * 기준 조상이 없으면 sr-only(absolute) 요소가 overflow-hidden 셸을 빠져나와 문서(html) 높이를 늘리고,
 * 메시지 목록 끝에서 굴린 휠이 문서로 이어져 셸 전체가 위로 밀린 빈 화면이 된다
 * (2026-11-25 신고 — 긴 대화에서 "답변 모델: …" sr-only 가 문서를 198px 늘림, 운영 실측).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const WEB = join(__dirname, '../../../../web');
const classNamesOf = (file: string, marker: string): string => {
    const src = readFileSync(join(WEB, file), 'utf8');
    const line = src.split('\n').find((l) => l.includes(marker));
    if (!line) throw new Error(`${file} 에서 ${marker} 를 찾지 못함`);
    return line.match(/className="([^"]+)"/)?.[1] ?? '';
};

describe('셸·채팅 스크롤 영역 containing block', () => {
    it('워크스페이스 셸(h-dvh overflow-hidden)은 relative 다', () => {
        const cls = classNamesOf('app/(workspace)/layout.tsx', 'h-dvh overflow-hidden').split(/\s+/);
        expect(cls).toEqual(expect.arrayContaining(['relative', 'h-dvh', 'overflow-hidden']));
    });

    it('채팅 스크롤 영역(overflow-y-auto)은 relative 다', () => {
        const cls = classNamesOf('components/chat/chat-scroll-area.tsx', 'ref={scrollerRef}').split(/\s+/);
        expect(cls).toEqual(expect.arrayContaining(['relative', 'overflow-y-auto']));
    });
});
