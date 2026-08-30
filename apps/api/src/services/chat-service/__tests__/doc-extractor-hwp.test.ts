/**
 * HWP/HWPX 추출 회귀 — kordoc 경로.
 *
 * `.hwp`·`.hwpx` 는 업로드 화이트리스트에 오래 있었으나 추출기 어느 목록에도 없어
 * **받아만 두고 본문을 못 읽었다**. 이 테스트는 그 회귀를 고정한다.
 *
 * 픽스처는 kordoc 자신으로 만든다(markdownToHwpx) — 외부 바이너리를 레포에 두지 않고도
 * 실제 HWPX 컨테이너를 왕복시킬 수 있다.
 */
import { extractAttachedDocuments } from '../doc-extractor';

type Attached = { name: string; data?: string; content?: string; truncated?: boolean };

/** kordoc 으로 실제 HWPX 바이트를 만든다(테스트 픽스처). */
async function makeHwpx(markdown: string): Promise<Buffer> {
    const { markdownToHwpx } = await import('kordoc');
    const out = await markdownToHwpx(markdown);
    if (Buffer.isBuffer(out)) return out;
    // 구현이 ArrayBuffer/Uint8Array 를 돌려줘도 받아들인다.
    return Buffer.from(out as unknown as ArrayBuffer);
}

describe('doc-extractor — HWP/HWPX (kordoc)', () => {
    jest.setTimeout(60_000);

    it('HWPX 첨부의 본문을 마크다운으로 추출한다', async () => {
        const hwpx = await makeHwpx('# 회의록\n\n첫째 안건은 예산이다.\n');
        const files: Attached[] = [{ name: '회의록.hwpx', data: hwpx.toString('base64') }];
        await extractAttachedDocuments(files as never);

        expect(typeof files[0].content).toBe('string');
        expect(files[0].content).toContain('회의록');
        expect(files[0].content).toContain('예산');
        // 추출에 성공하면 원본 base64 는 컨텍스트로 흘리지 않는다.
        expect(files[0].data).toBeUndefined();
    });

    it('표가 있는 문서도 구조를 보존해 추출한다', async () => {
        const hwpx = await makeHwpx('| 항목 | 값 |\n|---|---|\n| 가 | 1 |\n| 나 | 2 |\n');
        const files: Attached[] = [{ name: '표.hwpx', data: hwpx.toString('base64') }];
        await extractAttachedDocuments(files as never);

        expect(files[0].content).toContain('항목');
        expect(files[0].content).toContain('가');
    });

    it('HWPX 가 아닌 바이트는 추출 실패로 흡수하고 메타만 남긴다 (fail-open)', async () => {
        const files: Attached[] = [{ name: '깨진.hwpx', data: Buffer.from('not a hwpx').toString('base64') }];
        await expect(extractAttachedDocuments(files as never)).resolves.toBeUndefined();
        expect(files[0].content).toBeUndefined();
        expect(files[0].data).toBeUndefined();
    });

    it('이미 content 가 있으면 파싱하지 않는다', async () => {
        const files: Attached[] = [{ name: '기존.hwp', data: 'AAAA', content: '이미 추출된 본문' }];
        await extractAttachedDocuments(files as never);
        expect(files[0].content).toBe('이미 추출된 본문');
    });
});
