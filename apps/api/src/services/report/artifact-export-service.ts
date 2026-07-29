/**
 * 아티팩트 export 서비스 — html 아티팩트를 Docker 컨테이너에서 pdf/docx 로 변환.
 *
 * P1 보고서 파이프라인 Phase 3.
 * - pdf: task-runtime 이미지의 playwright chromium 으로 headless print (fonts-nanum 한글).
 *   변환 스크립트(node 프로그램)는 stdin 으로 전달 — html 은 base64 로 스크립트에 임베드,
 *   산출물은 stdout 에 base64 로 출력(바이너리 파이프 오염 방지).
 * - docx: /opt/pyenv 의 python-docx 로 reportdata source_data(JSON, stdin)에서 직접 생성.
 *
 * 격리: artifact-exec 와 동일한 3 샌드박스 공통 원칙 — cap-drop ALL·no-new-privileges·
 * non-root·read-only(+tmpfs)·network none·pids-limit·memory=memory-swap.
 *
 * @module services/report/artifact-export-service
 */
import { spawn } from 'child_process';
import { createLogger } from '../../utils/logger';
import { resolveDocker } from '../../mcp/sandbox-docker';
import { ARTIFACT_EXPORT } from '../../config/artifact-export';
import { REPORT_DOCX_SCRIPT } from './docx-script';

const log = createLogger('ArtifactExport');

export type ExportFormat = 'pdf' | 'docx';

export interface ArtifactExportResult {
    format: ExportFormat;
    mime: string;
    /** 변환 산출물 (base64) */
    dataBase64: string;
    durationMs: number;
}

export class ArtifactExportError extends Error {
    constructor(message: string, public statusCode: number, public code: string) {
        super(message);
        this.name = 'ArtifactExportError';
    }
}

/** PURE: docker run 인자 조립 (유닛테스트 대상). command 는 이미지 뒤 실행 명령. */
export function buildExportDockerArgs(command: string[]): string[] {
    const c = ARTIFACT_EXPORT;
    return [
        'run', '--rm', '-i', '--init',
        '--network', 'none',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--pids-limit', String(c.pidsLimit),
        // --memory-swap = --memory → swap 우회 차단 (3 샌드박스 공통 원칙)
        '--memory', c.memory, '--memory-swap', c.memory,
        '--cpus', c.cpus,
        '--user', c.user,
        '--read-only', '--tmpfs', `/tmp:rw,exec,size=${c.tmpfsSize}`,
        '-e', 'HOME=/tmp',
        c.image, ...command,
    ];
}

/**
 * pdf 변환용 node 프로그램 — stdin 으로 node 에 파이프된다.
 * html 은 base64 로 임베드(스크립트 인젝션 표면 제거), pdf 는 stdout 에 base64.
 * chromium 은 cap-drop ALL 환경이라 --no-sandbox 필수, /dev/shm 미가용이라
 * --disable-dev-shm-usage 로 /tmp(tmpfs) 사용.
 */
export function buildPdfScript(html: string): string {
    const b64 = Buffer.from(html, 'utf8').toString('base64');
    return `
const { chromium } = require('/opt/browser/node_modules/playwright');
const html = Buffer.from('${b64}', 'base64').toString('utf8');
(async () => {
    const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-crashpad'],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        // scale 0.64: 인쇄 레이아웃 폭 = 인쇄영역(190mm≈719px)/scale ≈ 1123px — 데스크톱
        // 레이아웃(page-max 1080 + 여백)이 그대로 들어와 우측 클리핑 없이 A4 에 맞는다.
        const pdf = await page.pdf({ format: 'A4', printBackground: true, scale: 0.64, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
        process.stdout.write(pdf.toString('base64'));
    } finally {
        await browser.close();
    }
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
`;
}

/** 컨테이너 실행 — stdout(base64 텍스트)·stderr 캡처. */
function runDocker(dockerPath: string, args: string[], stdinData: string): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number }> {
    return new Promise((resolve) => {
        const started = Date.now();
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const max = ARTIFACT_EXPORT.outputMaxBytes;
        const child = spawn(dockerPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, ARTIFACT_EXPORT.timeoutMs);
        child.stdout.on('data', (d: Buffer) => {
            if (stdout.length < max) stdout += d.toString('utf8');
        });
        child.stderr.on('data', (d: Buffer) => {
            if (stderr.length < 64 * 1024) stderr += d.toString('utf8');
        });
        child.on('error', (e) => {
            clearTimeout(timer);
            resolve({ stdout: '', stderr: `docker spawn 실패: ${e.message}`, exitCode: null, timedOut, durationMs: Date.now() - started });
        });
        child.on('close', (exitCode) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode, timedOut, durationMs: Date.now() - started });
        });
        child.stdin.on('error', () => { /* EPIPE 무시 */ });
        child.stdin.write(stdinData);
        child.stdin.end();
    });
}

/** 동시 변환 세마포어 — artifact-exec 와 동일 모델(단일 워커 전제). */
let inFlight = 0;

async function runExport(command: string[], stdinData: string, format: ExportFormat, mime: string): Promise<ArtifactExportResult> {
    if (!ARTIFACT_EXPORT.enabled) {
        throw new ArtifactExportError('export 기능이 비활성화되어 있습니다', 503, 'EXPORT_DISABLED');
    }
    const dockerPath = resolveDocker(ARTIFACT_EXPORT.dockerPath);
    if (!dockerPath) {
        throw new ArtifactExportError('변환 런타임(docker)을 찾을 수 없습니다', 503, 'DOCKER_NOT_FOUND');
    }
    if (inFlight >= ARTIFACT_EXPORT.maxConcurrent) {
        throw new ArtifactExportError('동시 변환이 많습니다. 잠시 후 다시 시도하세요.', 429, 'TOO_MANY_CONCURRENT');
    }
    inFlight++;
    try {
        const r = await runDocker(dockerPath, buildExportDockerArgs(command), stdinData);
        if (r.timedOut) {
            throw new ArtifactExportError(`변환 시간 초과 (${ARTIFACT_EXPORT.timeoutMs}ms)`, 504, 'EXPORT_TIMEOUT');
        }
        if (r.exitCode !== 0 || !r.stdout.trim()) {
            log.warn(`[Export] ${format} 변환 실패 exit=${r.exitCode}: ${r.stderr.slice(0, 500)}`);
            throw new ArtifactExportError('변환에 실패했습니다', 500, 'EXPORT_FAILED');
        }
        log.info(`[Export] ${format} 변환 완료 (${r.durationMs}ms, b64 ${r.stdout.length} chars)`);
        return { format, mime, dataBase64: r.stdout.trim(), durationMs: r.durationMs };
    } finally {
        inFlight--;
    }
}

/** html 아티팩트 → pdf (chromium headless print). */
export async function exportArtifactPdf(html: string): Promise<ArtifactExportResult> {
    if (Buffer.byteLength(html, 'utf8') > ARTIFACT_EXPORT.inputMaxBytes) {
        throw new ArtifactExportError('아티팩트가 너무 커서 변환할 수 없습니다', 413, 'INPUT_TOO_LARGE');
    }
    // 프로그램을 stdin 으로 — `docker run -i <image> node` 는 파이프된 stdin 을 스크립트로 실행.
    return runExport(['node'], buildPdfScript(html), 'pdf', 'application/pdf');
}

/** 보고서 source_data(reportdata JSON) → docx (python-docx). */
export async function exportArtifactDocx(sourceData: Record<string, unknown>): Promise<ArtifactExportResult> {
    const json = JSON.stringify(sourceData);
    if (Buffer.byteLength(json, 'utf8') > ARTIFACT_EXPORT.inputMaxBytes) {
        throw new ArtifactExportError('보고서 데이터가 너무 커서 변환할 수 없습니다', 413, 'INPUT_TOO_LARGE');
    }
    return runExport(
        ['python3', '-c', REPORT_DOCX_SCRIPT],
        json,
        'docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
}
