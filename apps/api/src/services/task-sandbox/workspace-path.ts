/**
 * 작업 디렉토리 경로 표기 정규화 — 실행기 공용 (컨테이너 샌드박스·로컬 브리지).
 *
 * 컨테이너 샌드박스의 작업 디렉토리는 `/workspace` 마운트 지점이라, 모델은 `/workspace/data.json`
 * 같은 절대경로를 자주 쓴다. 이는 탈출이 아니라 작업 디렉토리 기준 **같은 파일의 다른 표기**다.
 * 실행기별 경로 가드(샌드박스 safeResolveWorkspacePath · 로컬 브리지 디바이스 safeFrom)에 넘기기 전에
 * 상대경로로 푼다. 접두만 벗기므로 `..` 탈출 검사는 각 가드가 그대로 수행한다.
 *
 * @module services/task-sandbox/workspace-path
 */

/** 컨테이너 샌드박스의 작업 디렉토리(마운트 지점). */
export const SANDBOX_WORKSPACE_DIR = '/workspace';

/** `/workspace` → `.`, `/workspace/a/b` → `a/b`. 그 외 경로는 그대로 돌려준다. */
export function stripWorkspacePrefix(userPath: string): string {
    if (userPath === SANDBOX_WORKSPACE_DIR) return '.';
    return userPath.startsWith(`${SANDBOX_WORKSPACE_DIR}/`)
        ? userPath.slice(SANDBOX_WORKSPACE_DIR.length + 1) || '.'
        : userPath;
}
