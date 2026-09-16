/**
 * xlsx export(F20.1) — 정적 스크립트 계약(역슬래시 보존·수식 이스케이프·숫자 규칙)과
 * exportByFormat 분기(kind × format × source_data → 어떤 스크립트로 무엇을 넘기는지, 409).
 * docker 는 child_process.spawn 스텁으로 대신한다(실컨테이너 변환은 라이브 검증).
 */
import { EventEmitter } from 'events';

const spawned: Array<{ args: string[]; stdin: string }> = [];
jest.mock('child_process', () => ({
    spawn: jest.fn((_cmd: string, args: string[]) => {
        const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { on: () => void; write: (d: string) => void; end: () => void }; kill: () => void };
        const rec = { args, stdin: '' };
        spawned.push(rec);
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => undefined;
        child.stdin = {
            on: () => undefined,
            write: (d: string) => { rec.stdin += d; },
            end: () => { setImmediate(() => { child.stdout.emit('data', Buffer.from('UEsDBA==')); child.emit('close', 0); }); },
        };
        return child;
    }),
}));
jest.mock('../../../mcp/sandbox-docker', () => ({ resolveDocker: () => '/usr/bin/docker' }));
jest.mock('../../../config/artifact-export', () => {
    const actual = jest.requireActual('../../../config/artifact-export');
    return { ARTIFACT_EXPORT: { ...actual.ARTIFACT_EXPORT, enabled: true } };
});

import { exportByFormat, isExportFormat, ExportUnsupportedError } from '../artifact-export-service';
import { REPORT_XLSX_SCRIPT } from '../xlsx-script';
import { REPORT_DOCX_SCRIPT } from '../docx-script';

beforeEach(() => { spawned.length = 0; });

describe('REPORT_XLSX_SCRIPT', () => {
    it('stdin JSON → openpyxl → stdout base64 계약', () => {
        expect(REPORT_XLSX_SCRIPT).toContain('json.load(sys.stdin)');
        expect(REPORT_XLSX_SCRIPT).toContain('from openpyxl import Workbook');
        expect(REPORT_XLSX_SCRIPT).toContain('base64.b64encode');
    });
    it('정규식 역슬래시가 보존된다(String.raw — 일반 템플릿이면 \\d 가 d 로 바뀐다)', () => {
        expect(REPORT_XLSX_SCRIPT).toContain(String.raw`r'^-?(0|[1-9]\d*)(\.\d+)?$'`);
        expect(REPORT_XLSX_SCRIPT).toContain(String.raw`('=', '+', '-', '@', '\t', '\r')`);
    });
});

describe('isExportFormat', () => {
    it('pdf·docx·xlsx 만', () => {
        expect(['pdf', 'docx', 'xlsx'].every(isExportFormat)).toBe(true);
        expect(isExportFormat('csv')).toBe(false);
        expect(isExportFormat(undefined)).toBe(false);
    });
});

describe('exportByFormat', () => {
    const lastCommand = () => spawned[spawned.length - 1].args.slice(-3);

    it('csv 아티팩트 xlsx 는 source_data 없이 본문을 {csv} 로 넘긴다', async () => {
        const r = await exportByFormat('xlsx', { kind: 'csv', content: 'a,b\n1,2' }, null);
        expect(r.format).toBe('xlsx');
        expect(r.mime).toContain('spreadsheetml');
        expect(lastCommand()).toEqual(['python3', '-c', REPORT_XLSX_SCRIPT]);
        expect(JSON.parse(spawned[0].stdin)).toEqual({ csv: 'a,b\n1,2' });
    });

    it('보고서 html 의 xlsx·docx 는 source_data 를 넘긴다', async () => {
        await exportByFormat('xlsx', { kind: 'html', content: '<p/>' }, { REPORT_TITLE: 't' });
        expect(JSON.parse(spawned[0].stdin)).toEqual({ data: { REPORT_TITLE: 't' } });
        await exportByFormat('docx', { kind: 'html', content: '<p/>' }, { REPORT_TITLE: 't' });
        expect(lastCommand()).toEqual(['python3', '-c', REPORT_DOCX_SCRIPT]);
    });

    it('source_data 가 없는 html 의 xlsx·docx, html/svg 가 아닌 pdf 는 409(컨테이너 실행 없음)', async () => {
        await expect(exportByFormat('xlsx', { kind: 'html' }, null)).rejects.toMatchObject({ statusCode: 409, code: 'NO_SOURCE_DATA' });
        await expect(exportByFormat('docx', { kind: 'csv', content: 'a' }, undefined)).rejects.toBeInstanceOf(ExportUnsupportedError);
        await expect(exportByFormat('pdf', { kind: 'csv', content: 'a' }, null)).rejects.toMatchObject({ statusCode: 409, code: 'UNSUPPORTED_KIND' });
        expect(spawned).toHaveLength(0);
    });
});
