/**
 * 내부 파일 제외 셸 조각 — 기준점(code-diff.initWorkspaceBaseline)·턴 스냅숏(fork-workspace.snapshotWorkspaceTurn)·
 * diff 캡처(code-diff.captureWorkspaceDiff)가 `git add -A` 앞에 공통으로 붙인다.
 *
 * 한 번 추적된 파일에는 .git/info/exclude 가 듣지 않는다 — 기준점·스냅숏이 먼저 내부 파일(실시간 화면 숨김 파일 등)을
 * 추적해 버리면 장기 실행 후속이 그 스냅숏을 복원하고 완료 diff 에 수정 파일로 나온다. 매번 덮어써 멱등이다.
 *
 * @module services/agent-task/git-internal-exclude
 */
import { CODE_DIFF_INTERNAL_FILES } from '../../config/agent-task-tools';

/** PURE: 셸 단일 인용 */
const shq = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;

/** PURE: CODE_DIFF_INTERNAL_FILES 를 .git/info/exclude 에 쓰는 셸 조각(.git 이 있는 작업 공간 기준). */
export function writeInternalExcludeCmd(): string {
    return `mkdir -p .git/info && printf '%s\\n' ${CODE_DIFF_INTERNAL_FILES.map(shq).join(' ')} > .git/info/exclude`;
}
