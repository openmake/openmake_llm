/**
 * OS 별 차이 — 셸·PATH 구분자·폴더 이름 (Companion P4, Windows 지원).
 * 플랫폼을 인자로 받는 순수 함수로 둔다 — macOS 개발 장비에서 Windows 분기를 테스트할 수 있어야 한다.
 */

/** 셸 명령을 실행할 실행 파일과 인자. Windows 는 cmd.exe, 그 밖은 bash. */
export function shellInvocation(command: string, platform: NodeJS.Platform = process.platform, comSpec = process.env.ComSpec): { file: string; args: string[] } {
    if (platform === 'win32') return { file: comSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] };
    return { file: '/bin/bash', args: ['-c', command] };
}

/** PATH 환경변수의 구분자 */
export function pathListSeparator(platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? ';' : ':';
}

/** 경로의 마지막 구간(폴더 이름) — 두 구분자를 모두 본다. 루트면 경로 그대로. */
export function folderNameOf(root: string): string {
    const parts = root.split(/[\\/]+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : root;
}

/**
 * 같은 작업 안의 일괄 승인("이 작업 동안 모두 허용")을 받을 수 있는가.
 * 명령을 OS 샌드박스로 가두지 못하는 Windows 에서는 받지 않는다 — 대체 격리 수단이 준비될 때까지 명령마다 확인한다.
 */
export function bulkApprovalAllowed(platform: NodeJS.Platform = process.platform): boolean {
    return platform !== 'win32';
}
