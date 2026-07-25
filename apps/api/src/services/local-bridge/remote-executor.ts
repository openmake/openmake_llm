/**
 * ============================================================
 * Remote Executor — 로컬 브리지 경유 TaskExecutor 구현 (Cowork D1a)
 * ============================================================
 *
 * Agent Task 의 도구 호출을 연결된 디바이스(사용자 머신)로 위임한다.
 * 경로 스코프 강제는 디바이스측이 1차(realpath), 서버는 요청 형태만 고정(임의 RPC 금지).
 *
 * 샌드박스와의 차이:
 *   - localWorkdir=null → 호스트측 git 연산(diff/clone/PR)·파일 다운로드 미지원(가드로 skip)
 *   - runBrowser 미지원(D1) · cleanup 은 task_end 통지만 — **사용자 폴더를 삭제하지 않는다**
 *
 * @module services/local-bridge/remote-executor
 */
import type { TaskExecutor, ExecResult } from '../task-sandbox/executor';
import { getLocalBridgeRegistry, type BridgeResult, type BridgeRequestPayload } from './registry';
import { LOCAL_BRIDGE } from '../../config/local-bridge';
import { readFile as fsReadFile, stat } from 'fs/promises';
import { createLogger } from '../../utils/logger';

const logger = createLogger('RemoteExecutor');

function toExecResult(r: BridgeResult): ExecResult {
    return {
        stdout: (r.stdout ?? '').slice(0, LOCAL_BRIDGE.OUTPUT_CAP),
        stderr: (r.ok ? (r.stderr ?? '') : (r.error ?? r.stderr ?? '로컬 실행 실패')).slice(0, LOCAL_BRIDGE.OUTPUT_CAP),
        exitCode: r.ok ? (r.exitCode ?? 0) : (r.exitCode ?? -1),
        truncated: (r.stdout?.length ?? 0) > LOCAL_BRIDGE.OUTPUT_CAP,
        timedOut: false,
        durationMs: r.durationMs ?? 0,
    };
}

export class RemoteExecutor implements TaskExecutor {
    readonly taskId: string;
    readonly localWorkdir = null;
    readonly isBrowserEnabled = false;
    readonly browserStatePath = null;
    private readonly userId: string;
    private deviceLabel = 'local-device';

    constructor(taskId: string, userId: string) {
        this.taskId = taskId;
        this.userId = userId;
    }

    get label(): string { return `local:${this.deviceLabel}`; }

    /** 실행 준비 = 디바이스 연결 확인(도구 왕복 없음). 미연결이면 throw → 호출부 graceful degrade. */
    async create(): Promise<void> {
        const dev = getLocalBridgeRegistry().getDevice(this.userId);
        if (!dev) throw new Error('연결된 로컬 디바이스가 없습니다 — 데스크톱 앱에서 작업 폴더를 먼저 연결하세요.');
        this.deviceLabel = `${dev.label}`;
        logger.info(`[${this.taskId}] 로컬 실행기 준비 (device=${dev.deviceId}, folder="${dev.folderName}")`);
    }

    private req(payload: BridgeRequestPayload): Promise<BridgeResult> {
        return getLocalBridgeRegistry().request(this.userId, payload);
    }

    async exec(command: string): Promise<ExecResult> {
        return toExecResult(await this.req({ kind: 'exec', command }));
    }

    async runBrowser(): Promise<ExecResult> {
        return { stdout: '', stderr: '로컬 실행 작업에서는 browser 도구를 지원하지 않습니다(D1).', exitCode: -1, truncated: false, timedOut: false, durationMs: 0 };
    }

    async writeFile(relPath: string, content: string | Buffer): Promise<void> {
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        if (buf.byteLength > LOCAL_BRIDGE.MAX_WRITE_BYTES) {
            throw new Error(`파일이 너무 큽니다 (${buf.byteLength}b > ${LOCAL_BRIDGE.MAX_WRITE_BYTES}b)`);
        }
        const r = await this.req({ kind: 'write', path: relPath, contentB64: buf.toString('base64') });
        if (!r.ok) throw new Error(r.error ?? '로컬 파일 쓰기 실패');
    }

    /** 호스트 파일(입력 첨부 스풀)을 읽어 브리지로 전송 — 캡 초과는 거부. */
    async importFile(relPath: string, srcAbsPath: string): Promise<void> {
        const st = await stat(srcAbsPath);
        if (st.size > LOCAL_BRIDGE.MAX_WRITE_BYTES) {
            throw new Error(`첨부가 로컬 전송 상한을 초과합니다 (${st.size}b > ${LOCAL_BRIDGE.MAX_WRITE_BYTES}b)`);
        }
        await this.writeFile(relPath, await fsReadFile(srcAbsPath));
    }

    async readFile(relPath: string): Promise<string> {
        const r = await this.req({ kind: 'read', path: relPath });
        if (!r.ok) throw new Error(r.error ?? '로컬 파일 읽기 실패');
        return (r.content ?? '').slice(0, LOCAL_BRIDGE.OUTPUT_CAP);
    }

    async listDir(relPath = '.'): Promise<string[]> {
        const r = await this.req({ kind: 'list', path: relPath });
        if (!r.ok) throw new Error(r.error ?? '로컬 디렉토리 조회 실패');
        return r.entries ?? [];
    }

    async listWorkspaceFiles(): Promise<string[]> {
        const r = await this.req({ kind: 'listAll' });
        return r.ok ? (r.entries ?? []) : [];
    }

    async deleteFile(relPath: string): Promise<void> {
        const r = await this.req({ kind: 'delete', path: relPath });
        if (!r.ok) throw new Error(r.error ?? '로컬 파일 삭제 실패');
    }

    /** 종료 통지만 — 사용자 폴더는 절대 삭제하지 않는다(removeWorkspace 무시). */
    async cleanup(): Promise<void> {
        await this.req({ kind: 'task_end' }).catch(() => { /* best-effort */ });
        logger.info(`[${this.taskId}] 로컬 실행기 세션 종료 통지`);
    }
}
