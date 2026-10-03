/**
 * 큰 도구 결과를 작업 공간 파일로 보관 — 상한을 넘는 결과를 버리지 않고 파일로 쓰고, 모델에는
 * 앞·뒤 미리보기(tool-result-truncate)와 경로, 이어서 볼 줄 번호를 준다.
 *
 * 종전에는 상한을 넘는 가운데 부분이 사라졌다(스텝 기록에도 절단본만 남는다). 파일로 두면 모델이
 * view 의 start_line(task-sandbox/file-view)으로 필요한 구간만 볼 수 있다.
 * 보관할 수 없으면(꺼짐·대상 없음·너무 큼·쓰기 실패) null 을 돌려 호출부가 종전 절단을 쓴다(fail-open).
 *
 * @module services/agent-task/tool-result-spill
 */
import { randomUUID } from 'crypto';
import { TOOL_RESULT_SPILL } from '../../config/agent-task-context';
import { getToolResultSpillNotice } from '../../prompts/agent-task-context';
import { truncateToolResult } from './tool-result-truncate';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ToolResultSpill');

/** 보관 대상 — 작업 공간에 파일을 쓸 수 있는 것(TaskExecutor.writeFile). */
export interface SpillTarget {
    writeFile(relPath: string, content: string): Promise<void>;
}

/** 보관 디렉터리의 .gitignore 를 이미 쓴 대상 — 변경분 diff(code-diff 의 `git add -A`)에 보관 파일이 섞이지 않게 한다. */
const ignored = new WeakSet<SpillTarget>();

/**
 * raw 가 cap 을 넘으면 파일로 쓰고 미리보기 + 안내를 돌려준다. 그 밖에는 null.
 * 안내의 줄 번호는 미리보기 앞부분이 끝나는 줄 — 그 줄부터 보면 생략된 구간이 이어진다.
 */
export async function spillToolResult(
    toolName: string, raw: string, opts: { cap: number; headRatio: number; target: SpillTarget | null | undefined },
): Promise<string | null> {
    if (!TOOL_RESULT_SPILL.ENABLED || !opts.target || raw.length <= opts.cap) return null;
    if (raw.length > TOOL_RESULT_SPILL.MAX_FILE_CHARS || TOOL_RESULT_SPILL.SKIP_TOOLS.includes(toolName)) return null;
    const safeName = toolName.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'tool';
    const path = `${TOOL_RESULT_SPILL.DIR}/${safeName}-${randomUUID().slice(0, 8)}.txt`;
    try {
        if (!ignored.has(opts.target)) {
            await opts.target.writeFile(`${TOOL_RESULT_SPILL.DIR}/.gitignore`, '*\n');
            ignored.add(opts.target);
        }
        await opts.target.writeFile(path, raw);
    } catch (e) {
        logger.warn(`도구 결과 보관 실패 — 절단으로 대체 (${toolName}): ${e instanceof Error ? e.message : String(e)}`);
        return null;
    }
    const ratio = Math.min(1, Math.max(0, opts.headRatio));
    const headLines = raw.slice(0, Math.floor(opts.cap * ratio)).split('\n').length; // 앞부분이 끝나는 줄(부분만 보인 줄)
    const preview = truncateToolResult(raw, opts.cap, opts.headRatio);
    return `${preview}\n${getToolResultSpillNotice(path, raw.length, raw.split('\n').length, headLines)}`;
}
