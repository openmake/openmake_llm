/**
 * Agent Task 입력 첨부 주입 — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/task-inputs
 */
import { TASK_UPLOAD_DIR } from '../../config/task-sandbox';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { AgentTaskInputFile } from './types';
import { resolveStoredPath } from './upload-store';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskService');

/**
 * 입력 첨부(파일+이미지)를 샌드박스 workspace 의 uploads/ 하위에 기록하고 안내 목록 행을 반환.
 * 바이너리 원본(data)이 있으면 원본 바이트를 그대로 기록해 에이전트가 openpyxl 등으로
 * 직접 파싱할 수 있게 하고, 추출 텍스트(content)는 `<원본명>.txt` 로 병행 기록한다.
 * 이미지(dataURL)는 디코드해 image_N.<ext> 로 기록(vision 채널과 병행 제공).
 * 파일명은 경로 성분 제거(디렉토리 주입 차단) + 제어문자 치환으로 정규화하고 충돌 시
 * 인덱스 접두어를 붙인다. 개별 실패는 작업을 죽이지 않는다 — 목록 행에 실패로 표기.
 */
export async function writeInputFilesToWorkspace(
    runtime: TaskRuntime,
    files: AgentTaskInputFile[],
    images: string[] = [],
): Promise<string[]> {
    const lines: string[] = [];
    const used = new Set<string>();
    const claim = (candidate: string, i: number): string => {
        const name = used.has(candidate) ? `${i}_${candidate}` : candidate;
        used.add(name);
        return name;
    };
    const write = async (rel: string, body: string | Buffer, label: string): Promise<void> => {
        try {
            await runtime.writeWorkspaceFile(rel, body);
            lines.push(`- ${rel}${label}`);
        } catch (e) {
            logger.warn(`[AgentTask] 입력 파일 기록 실패 (${rel}): ${e instanceof Error ? e.message : e}`);
            lines.push(`- (기록 실패로 제외됨: ${rel})`);
        }
    };
    for (const [i, f] of files.entries()) {
        const base = ((f.name.split(/[\\/]/).pop() ?? '').replace(/\p{Cc}/gu, '_').trim()) || `file_${i}`;
        const hasStored = typeof f.storedPath === 'string' && f.storedPath.length > 0;
        const hasData = typeof f.data === 'string' && f.data.length > 0;
        const hasContent = typeof f.content === 'string' && f.content.length > 0;
        if (!hasStored && !hasData && !hasContent) {
            lines.push(`- (내용을 추출하지 못해 제외됨: ${f.name})`);
            continue;
        }
        if (hasStored) {
            // multipart 업로드 원본 — 디스크 스토어에서 fs copy 로 주입 (base64/Buffer 미적재)
            const rel = `${TASK_UPLOAD_DIR}/${claim(base, i)}`;
            try {
                await runtime.importWorkspaceFile(rel, resolveStoredPath(f.storedPath!));
                lines.push(`- ${rel} (원본 파일)`);
            } catch (e) {
                logger.warn(`[AgentTask] 입력 파일 복사 실패 (${rel}): ${e instanceof Error ? e.message : e}`);
                lines.push(`- (기록 실패로 제외됨: ${rel})`);
            }
        } else if (hasData) {
            // 바이너리 원본 — base64 디코드해 그대로 기록 (직접 파싱용)
            await write(`${TASK_UPLOAD_DIR}/${claim(base, i)}`, Buffer.from(f.data!, 'base64'), ' (원본 파일)');
        }
        if (hasContent) {
            const label =
                (f.extracted ? ` (원본 ${f.name} 에서 추출한 텍스트)` : '') +
                (f.truncated ? ' — 길이 제한으로 일부 절단됨' : '');
            await write(`${TASK_UPLOAD_DIR}/${claim(f.extracted ? `${base}.txt` : base, i)}`, f.content!, label);
        }
    }
    for (const [i, dataUrl] of images.entries()) {
        const m = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/s);
        if (!m) {
            lines.push(`- (형식을 해석하지 못해 제외된 이미지 #${i + 1})`);
            continue;
        }
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1].replace(/[^a-zA-Z0-9]/g, '') || 'img';
        const rel = `${TASK_UPLOAD_DIR}/${claim(`image_${i + 1}.${ext}`, files.length + i)}`;
        await write(rel, Buffer.from(m[2], 'base64'), ' (첨부 이미지 — 대화에도 vision 으로 전달됨)');
    }
    return lines;
}
