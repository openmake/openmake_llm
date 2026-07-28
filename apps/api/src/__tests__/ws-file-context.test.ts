/**
 * buildFileContext 단위 테스트 — 채팅 파일 첨부 (2026-06-12 전체 파일 타입 허용)
 *
 * 텍스트 파일 fenced block 주입, 바이너리 메타 전달,
 * FILE_ATTACH_LIMITS 캡(개수/파일당 글자/합산 글자) 적용을 검증한다.
 */
// FILE_ATTACH_LIMITS 는 env 로 오버라이드 가능하고 기본값도 상향돼 왔다(50/2M/10M).
// 캡 로직 검증이 목적이므로 작은 값으로 고정해 결정적·경량으로 만든다.
jest.mock('../config/runtime-limits', () => {
    const actual = jest.requireActual('../config/runtime-limits');
    return {
        ...actual,
        FILE_ATTACH_LIMITS: {
            ...actual.FILE_ATTACH_LIMITS,
            MAX_FILES: 10,
            MAX_CHARS_PER_FILE: 100_000,
            MAX_TOTAL_CHARS: 300_000,
        },
    };
});

import { buildFileContext } from '../services/chat-service/attach-context';
import { FILE_ATTACH_LIMITS } from '../config/runtime-limits';

describe('buildFileContext', () => {
    it('파일이 없으면 빈 문자열을 반환한다', () => {
        expect(buildFileContext(undefined)).toBe('');
        expect(buildFileContext([])).toBe('');
    });

    it('텍스트 파일은 파일명/타입 헤더와 fenced block 으로 주입한다', () => {
        const ctx = buildFileContext([
            { id: 'a1', name: 'notes.md', type: 'text/markdown', content: '# Hello\nworld', size: 14 },
        ]);
        expect(ctx).toContain('## 📎 첨부 파일');
        expect(ctx).toContain('### notes.md (text/markdown)');
        expect(ctx).toContain('# Hello\nworld');
        expect(ctx).toContain('```');
    });

    it('content 없는 바이너리 파일은 메타(이름/타입/크기)만 기재한다', () => {
        const ctx = buildFileContext([
            { id: 'b1', name: 'data.zip', type: 'application/zip', size: 2048 },
        ]);
        expect(ctx).toContain('### data.zip (application/zip, 2.0KB)');
        expect(ctx).toContain('바이너리 파일');
        expect(ctx).not.toContain('```');
    });

    it('내용에 ``` 가 있으면 더 긴 fence 로 감싸 조기 종료를 막는다', () => {
        const ctx = buildFileContext([
            { id: 'g1', name: 'doc.md', type: 'text/markdown', content: '설명\n```js\ncode\n```\n끝' },
        ]);
        // 내용의 ``` (3런) 보다 긴 ```` (4런) fence 사용
        expect(ctx).toContain('````');
        expect(ctx.indexOf('````')).toBeLessThan(ctx.indexOf('```js'));
    });

    it('클라이언트 truncated 플래그가 오면 서버 캡 미만이어도 절단 안내를 붙인다', () => {
        const ctx = buildFileContext([
            { id: 'h1', name: 'cut.txt', type: 'text/plain', content: '잘린 내용', truncated: true },
        ]);
        expect(ctx).toContain('자만 포함됨');
    });

    it('빈 텍스트 파일(content="")은 바이너리가 아닌 빈 파일로 기재한다', () => {
        const ctx = buildFileContext([
            { id: 'i1', name: 'empty.txt', type: 'text/plain', content: '', size: 0 },
        ]);
        expect(ctx).toContain('빈 텍스트 파일');
        expect(ctx).not.toContain('바이너리 파일');
    });

    it('파일당 글자 수 캡을 초과하면 절단하고 안내 문구를 붙인다', () => {
        const over = 'x'.repeat(FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE + 5000);
        const ctx = buildFileContext([
            { id: 'c1', name: 'big.txt', type: 'text/plain', content: over },
        ]);
        expect(ctx).toContain('자만 포함됨');
        // 절단된 본문 + 헤더/안내 길이 — 원본 전체(캡+5000자)보다 짧아야 함
        expect(ctx.length).toBeLessThan(over.length);
    });

    it('합산 글자 수 캡 초과 시 이후 파일 내용은 생략 안내로 대체한다', () => {
        const half = 'y'.repeat(FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE);
        const files = Array.from({ length: 5 }, (_, i) => ({
            id: `d${i}`, name: `f${i}.txt`, type: 'text/plain', content: half,
        }));
        const ctx = buildFileContext(files);
        // 300k 합산 캡 / 100k per-file → 앞 3개 포함, 4번째부터 생략
        expect(ctx).toContain('전체 첨부 용량 한도 초과로 내용 생략');
        expect(ctx).toContain('### f4.txt');
    });

    it('최대 파일 개수를 초과하면 초과분을 생략하고 안내한다', () => {
        const files = Array.from({ length: FILE_ATTACH_LIMITS.MAX_FILES + 3 }, (_, i) => ({
            id: `e${i}`, name: `e${i}.txt`, type: 'text/plain', content: 'ok',
        }));
        const ctx = buildFileContext(files);
        expect(ctx).toContain(`${FILE_ATTACH_LIMITS.MAX_FILES}개만 포함`);
        expect(ctx).toContain('3개 생략');
        expect(ctx).not.toContain(`### e${FILE_ATTACH_LIMITS.MAX_FILES}.txt`);
    });

    it('이름이 비정상인 항목은 건너뛴다', () => {
        const ctx = buildFileContext([
            { id: 'f1', name: undefined as unknown as string, type: 'text/plain', content: 'skip-me' },
            { id: 'f2', name: 'ok.txt', type: 'text/plain', content: 'keep-me' },
        ]);
        expect(ctx).not.toContain('skip-me');
        expect(ctx).toContain('keep-me');
    });
});
