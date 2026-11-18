/**
 * 재개 때 system 의 worktree 격리 안내를 실제 작업 브랜치에 맞춘다(D4) — fork·같은 작업 재개는 체크포인트의 system 을
 * 그대로 쓰므로, 그 안의 안내가 원 작업(다른 브랜치)을 말하면 모델이 최종 답에 남의 브랜치 이름을 쓴다.
 * @module prompts/agent-task-isolation-note
 */
import { getWorktreeIsolationNote, WORKTREE_ISOLATION_HEADING } from './agent-task-prompt';

/**
 * PURE: 격리 안내 구획(빈 줄 + 제목 줄부터 다음 `## ` 제목 줄 앞 또는 끝까지)을 branch·path(작업 폴더)에 맞춘다.
 * 같은 브랜치·경로를 말하면 그대로 돌려준다(프롬프트 캐시 유지). fork·옛 체크포인트처럼 경로가 다르거나 없으면 바꾼다. 아니면 옛 구획을 빼고, branch 가 있으면 새 안내를 끝에 붙인다.
 */
export function syncWorktreeIsolationNote(system: string, branch: string | null, path?: string | null): string {
    const note = branch ? getWorktreeIsolationNote(branch, path) : '';
    const start = system.indexOf(`\n${WORKTREE_ISOLATION_HEADING}`);
    if (start < 0) return system + note;
    const next = system.indexOf('\n## ', start + 1);
    const end = next < 0 ? system.length : next;
    if (system.slice(start, end).replace(/\n+$/, '') === note) return system;
    // 안내는 빈 줄('')로 시작해 join 되므로 구획 시작은 그 앞 줄바꿈이다 — 뒤 구획이 있으면 구획 사이 빈 줄 하나를 남긴다
    const rest = next < 0 ? '' : system.slice(next);
    return system.slice(0, start) + rest + note;
}
