/**
 * exec 가드레일(보안 경계 아님, 우발·명백 유출 백스톱) — 매칭 시 확인 없이 즉시 거부.
 * 난독화로 우회 가능함을 인정하되, LLM 인젝션·실수로 인한 명백한 파괴/유출을 차단한다.
 */
export const EXEC_DENYLIST: { re: RegExp; why: string }[] = [
    { re: /(^|[;&|(]|\s)sudo\s/, why: '권한 상승(sudo)' },
    { re: /(^|[;&|(]|\s)doas\s/, why: '권한 상승(doas)' },
    { re: /(curl|wget)\s[^|]*\|\s*(sh|bash|zsh)\b/, why: '원격 스크립트 직접 실행(pipe-to-shell)' },
    { re: /\|\s*(sh|bash|zsh)\b/, why: '파이프-투-셸 실행' },
    { re: /\brm\s+-\w*\s+(\/|~|\$HOME|\$\{HOME\})(\s|$)/, why: '홈/루트 대량 삭제' },
    { re: /\.ssh(\/|\b)/, why: 'SSH 키 디렉토리 접근' },
    { re: /id_rsa|id_ed25519|\.aws\/credentials|\.config\/gcloud/, why: '자격증명 파일 접근' },
    { re: /:\s*\(\s*\)\s*\{/, why: 'fork bomb' },
    { re: /\bdd\s+if=|\bmkfs\b|>\s*\/dev\/(disk|sd|rdisk)/, why: '디스크 파괴 연산' },
];

export function matchDenylist(cmd: string): string | null {
    const c = String(cmd);
    for (const d of EXEC_DENYLIST) if (d.re.test(c)) return d.why;
    return null;
}
