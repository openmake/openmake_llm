/**
 * pdf-vision 유닛 테스트 — 예산 계산·게이트·graceful skip·다중 PDF 예산 공유.
 * pdftoppm/pdfinfo 는 child_process mock 으로 대체 (CI poppler 미설치 무관).
 */
import * as fsSync from 'fs';
import * as path from 'path';

// promisify(execFile) 이 {stdout, stderr} 를 돌려주도록 promisify.custom 구현을 심는다.
// 동작은 테스트별로 mockExecHandler 를 교체해 제어한다.
let mockExecHandler: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
jest.mock('child_process', () => {
    const actual = jest.requireActual('child_process');
    const util = jest.requireActual('util');
    const execFile: any = jest.fn();
    execFile[util.promisify.custom] = (cmd: string, args: string[]) => mockExecHandler(cmd, args);
    return { ...actual, execFile };
});

// 운영 .env 값(예: CAP 8 상향)에 흔들리지 않도록 한도를 고정 — .env 의존 테스트 함정 방지
jest.mock('../../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../../config/runtime-limits');
    return {
        ...actual,
        PDF_VISION_LIMITS: {
            ...actual.PDF_VISION_LIMITS,
            ENABLED: true, TOTAL_IMAGE_CAP: 4, MAX_PAGES: 4, DPI: 120, RENDER_TIMEOUT_MS: 5000,
        },
    };
});

import { buildPdfVisionAttachment } from '../pdf-vision';
import { PDF_VISION_LIMITS } from '../../../config/runtime-limits';

const PDF_DATA = Buffer.from('%PDF-1.4 dummy').toString('base64');

/** pdftoppm 렌더 콜을 흉내내 출력 prefix 에 페이지 jpg 를 실제로 만들어 둔다 */
function fakeRender(args: string[], actualPages: number): void {
    const prefix = args[args.length - 1];
    const last = parseInt(args[args.indexOf('-l') + 1], 10);
    const n = Math.min(last, actualPages);
    for (let i = 1; i <= n; i++) {
        fsSync.writeFileSync(`${prefix}-${i}.jpg`, Buffer.from(`jpg-${path.basename(prefix)}-${i}`));
    }
}

/** 정상 동작 핸들러 — pdfinfo 는 pages 페이지 보고, pdftoppm 은 실제 파일 생성 */
function okHandler(pagesByCall: number[]): (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }> {
    let renderIdx = 0;
    let infoIdx = 0;
    return async (cmd, args) => {
        if (cmd === 'pdftoppm' && args[0] === '-v') return { stdout: '', stderr: 'pdftoppm ok' };
        if (cmd === 'pdfinfo') return { stdout: `Pages: ${pagesByCall[infoIdx++]}\n`, stderr: '' };
        if (cmd === 'pdftoppm') { fakeRender(args, pagesByCall[renderIdx++]); return { stdout: '', stderr: '' }; }
        throw new Error(`unexpected cmd: ${cmd}`);
    };
}

describe('buildPdfVisionAttachment', () => {
    beforeEach(() => {
        mockExecHandler = okHandler([3]);
    });

    it('PDF 없음/파일 없음이면 빈 결과', async () => {
        expect((await buildPdfVisionAttachment(undefined, 0)).images).toHaveLength(0);
        expect((await buildPdfVisionAttachment([], 0)).images).toHaveLength(0);
        expect((await buildPdfVisionAttachment([{ name: 'a.txt', content: 'x' }], 0)).images).toHaveLength(0);
        // content 가 이미 있는 파일(data 병존)은 렌더 대상 아님
        expect((await buildPdfVisionAttachment([{ name: 'a.pdf', content: 'x', data: PDF_DATA }], 0)).images).toHaveLength(0);
    });

    it('사용자 이미지가 총 상한을 채우면 예산 0 — 렌더 시도 없이 빈 결과', async () => {
        mockExecHandler = () => { throw new Error('호출되면 안 됨'); };
        const r = await buildPdfVisionAttachment(
            [{ name: 'a.pdf', data: PDF_DATA }],
            PDF_VISION_LIMITS.TOTAL_IMAGE_CAP,
        );
        expect(r.images).toHaveLength(0);
        expect(r.note).toBe('');
    });

    it('3페이지 PDF → 3장 렌더 + 안내문에 총 페이지 수 기재', async () => {
        mockExecHandler = okHandler([3]);
        const r = await buildPdfVisionAttachment([{ name: 'report.pdf', data: PDF_DATA }], 0);
        expect(r.images).toHaveLength(3);
        expect(r.images[0].startsWith('data:image/jpeg;base64,')).toBe(true);
        expect(r.note).toContain('report.pdf');
        expect(r.note).toContain('총 3페이지');
    });

    it('다중 PDF 는 순서대로 예산 공유 (3p + 5p, 예산 4 → 3장 + 1장)', async () => {
        mockExecHandler = okHandler([3, 5]);
        const r = await buildPdfVisionAttachment(
            [{ name: 'a.pdf', data: PDF_DATA }, { name: 'b.pdf', data: PDF_DATA }],
            0,
        );
        expect(r.images).toHaveLength(4);
        expect(r.note).toContain('a.pdf');
        expect(r.note).toContain('b.pdf: 총 5페이지 중 1페이지 이미지 첨부');
    });

    it('렌더 실패는 graceful skip — 빈 결과, throw 없음', async () => {
        mockExecHandler = async (cmd, args) => {
            if (cmd === 'pdftoppm' && args[0] === '-v') return { stdout: '', stderr: '' };
            throw new Error('render boom');
        };
        const r = await buildPdfVisionAttachment([{ name: 'a.pdf', data: PDF_DATA }], 0);
        expect(r.images).toHaveLength(0);
        expect(r.note).toBe('');
    });
});
