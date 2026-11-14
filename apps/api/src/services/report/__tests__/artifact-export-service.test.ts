/**
 * 아티팩트 export 순수 함수 테스트 — docker 인자 격리 원칙·pdf 스크립트 임베딩 계약.
 */
import { buildExportDockerArgs, buildPdfScript, runDocker } from '../artifact-export-service';
import { REPORT_DOCX_SCRIPT } from '../docx-script';

describe('buildExportDockerArgs', () => {
    it('3 샌드박스 공통 격리 원칙 — cap-drop·no-new-privileges·read-only·network none·swap 차단', () => {
        const args = buildExportDockerArgs(['node']);
        expect(args).toContain('--cap-drop');
        expect(args).toContain('ALL');
        expect(args).toContain('no-new-privileges');
        expect(args).toContain('--read-only');
        expect(args[args.indexOf('--network') + 1]).toBe('none');
        // --memory-swap = --memory (swap 우회 차단)
        const mem = args[args.indexOf('--memory') + 1];
        expect(args[args.indexOf('--memory-swap') + 1]).toBe(mem);
        expect(args[args.length - 1]).toBe('node');
    });

    it('command 배열이 이미지 뒤에 그대로 이어진다', () => {
        const args = buildExportDockerArgs(['python3', '-c', 'print(1)']);
        expect(args.slice(-3)).toEqual(['python3', '-c', 'print(1)']);
    });
});

describe('buildPdfScript', () => {
    it('html 은 base64 로만 임베드 — 원문/따옴표가 스크립트에 노출되지 않는다', () => {
        const html = `<script>alert('x "quote" \\backtick\`')</script>`;
        const script = buildPdfScript(html);
        expect(script).not.toContain('alert(');
        expect(script).toContain(Buffer.from(html, 'utf8').toString('base64'));
        expect(script).toContain('--no-sandbox');
        expect(script).toContain("toString('base64')");
    });
});

describe('REPORT_DOCX_SCRIPT', () => {
    it('정적 스크립트 — stdin JSON 읽기·stdout base64 출력 계약 유지', () => {
        expect(REPORT_DOCX_SCRIPT).toContain('json.load(sys.stdin)');
        expect(REPORT_DOCX_SCRIPT).toContain('base64.b64encode');
    });
});

describe('runDocker — stderr 이어 디코드(UTF-8 청크 경계)', () => {
    it('다바이트 글자가 조각 경계에 걸려도 stderr(실패 사유)가 원문과 같다', async () => {
        const script = '{ const b = Buffer.from("변환 실패: 글꼴 없음"); process.stderr.write(b.subarray(0, 4));'
            + ' setTimeout(() => process.stderr.write(b.subarray(4)), 50); }';
        const r = await runDocker(process.execPath, ['-e', script], '');
        expect(r).toMatchObject({ stderr: '변환 실패: 글꼴 없음', exitCode: 0, timedOut: false });
    });
});
