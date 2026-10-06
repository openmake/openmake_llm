/**
 * 로컬 브라우저 업로드(uploadFile, 2026-10-06) — 사이트 정책 판정·파일 범위 검사·정책 차단 표식.
 * 업로드는 허용 목록과 무관하게 항상 승인 대상이고, 승인은 그 호스트·파일 목록에만 묶인다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkBrowserAction, classifyBrowserAction, planBrowserActions } from '@openmake/config';
import { resolveUploadFiles } from '../browser/upload-files';
import { browserPolicyBlockOf, uploadRejectedPolicyBlock } from '../browser/policy-block';
import { BROWSER_UPLOAD_MAX_FILE_BYTES, BROWSER_UPLOAD_MAX_FILES } from '../constants';

const POLICY = { allow: ['upload.example.com'], deny: [] };
const UPLOAD = { type: 'uploadFile', selector: 'input[type=file]', files: ['docs/a.pdf', 'b.png'] };

describe('사이트 정책 — uploadFile', () => {
    it('업로드는 별도 분류(upload)다', () => {
        expect(classifyBrowserAction(UPLOAD)).toBe('upload');
    });

    it('허용 목록 사이트여도 승인 대상이고, 쓰기 목록이 아니라 업로드 목록에 파일 이름과 함께 실린다', () => {
        const plan = planBrowserActions([{ type: 'goto', url: 'https://upload.example.com/form' }, UPLOAD], null, POLICY);
        expect(plan.offListWrites).toEqual([]);
        expect(plan.uploads).toEqual([{ index: 1, host: 'upload.example.com', files: ['docs/a.pdf', 'b.png'] }]);
    });

    it('files 가 배열이 아니면 빈 목록으로 싣는다(문자열만 남긴다)', () => {
        const plan = planBrowserActions([{ type: 'uploadFile', selector: 'x', files: 'a.pdf' }, { type: 'uploadFile', selector: 'x', files: ['a', 3] }], 'https://upload.example.com/', POLICY);
        expect(plan.uploads.map((u) => u.files)).toEqual([[], ['a']]);
    });

    it('기기 판정 — 승인 없이는 허용 목록 사이트에서도 막는다', () => {
        expect(checkBrowserAction(UPLOAD, 'upload.example.com', POLICY, ['upload.example.com'])).toMatch(/업로드/);
    });

    it('기기 판정 — 같은 호스트·같은 파일 목록의 승인만 통과한다', () => {
        const approved = [{ host: 'upload.example.com', files: ['docs/a.pdf', 'b.png'] }];
        expect(checkBrowserAction(UPLOAD, 'upload.example.com', POLICY, [], approved)).toBeNull();
        expect(checkBrowserAction(UPLOAD, 'other.example.com', POLICY, [], approved)).toMatch(/업로드/);
        expect(checkBrowserAction({ ...UPLOAD, files: ['docs/a.pdf'] }, 'upload.example.com', POLICY, [], approved)).toMatch(/업로드/);
        expect(checkBrowserAction({ ...UPLOAD, files: ['b.png', 'docs/a.pdf'] }, 'upload.example.com', POLICY, [], approved)).toMatch(/업로드/);
        expect(checkBrowserAction(UPLOAD, null, POLICY, [], [{ host: '', files: UPLOAD.files }])).toMatch(/업로드/);
    });
});

describe('resolveUploadFiles — 허용 폴더 안의 파일만', () => {
    let base: string;
    let outside: string;
    beforeAll(() => {
        base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-upload-base-')));
        outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-upload-out-')));
        fs.mkdirSync(path.join(base, 'docs'));
        fs.writeFileSync(path.join(base, 'docs', 'a.pdf'), 'pdf');
        fs.writeFileSync(path.join(base, 'b.png'), 'png');
        fs.writeFileSync(path.join(base, '.env'), 'SECRET=1');
        fs.mkdirSync(path.join(base, '.git'));
        fs.writeFileSync(path.join(base, '.git', 'config'), 'x');
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(base, 'link.txt'));
        fs.symlinkSync(path.join(base, '.env'), path.join(base, 'env-link.txt'));
        fs.writeFileSync(path.join(base, 'big.bin'), Buffer.alloc(BROWSER_UPLOAD_MAX_FILE_BYTES + 1));
    });
    afterAll(() => {
        fs.rmSync(base, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    it('폴더 기준 상대 경로를 실제 경로로 푼다', async () => {
        await expect(resolveUploadFiles(base, ['docs/a.pdf', 'b.png'])).resolves.toEqual([path.join(base, 'docs', 'a.pdf'), path.join(base, 'b.png')]);
    });

    it.each([
        ['폴더 밖(..)', ['../x.txt']],
        ['절대 경로', [path.resolve(os.tmpdir(), 'omk-abs-secret.txt')]],
        ['심볼릭 링크로 밖', ['link.txt']],
        ['숨김 파일', ['.env']],
        ['숨김 폴더 안', ['.git/config']],
        ['링크가 숨김 파일을 가리킴', ['env-link.txt']],
        ['크기 상한 초과', ['big.bin']],
        ['없는 파일', ['nope.txt']],
        ['폴더', ['docs']],
        ['빈 목록', []],
        ['문자열 아님', [3]],
        ['빈 이름', ['']],
    ])('거절: %s', async (_name, files) => {
        await expect(resolveUploadFiles(base, files)).rejects.toThrow();
    });

    it('거절: 배열이 아님', async () => {
        await expect(resolveUploadFiles(base, 'b.png')).rejects.toThrow();
    });

    it(`거절: 파일 수 상한(${BROWSER_UPLOAD_MAX_FILES}) 초과`, async () => {
        await expect(resolveUploadFiles(base, Array.from({ length: BROWSER_UPLOAD_MAX_FILES + 1 }, () => 'b.png'))).rejects.toThrow(/개/);
    });
});

describe('정책 차단 표식 — 업로드', () => {
    it('승인과 맞지 않아 막은 업로드는 upload_unapproved', () => {
        expect(browserPolicyBlockOf(UPLOAD, 'upload.example.com', POLICY)).toEqual({ kind: 'upload_unapproved', host: 'upload.example.com', action: 'uploadFile' });
    });
    it('파일 검사에서 거절한 업로드는 upload_rejected — 파일 이름은 싣지 않는다', () => {
        expect(uploadRejectedPolicyBlock('upload.example.com')).toEqual({ kind: 'upload_rejected', host: 'upload.example.com', action: 'uploadFile' });
    });
});
