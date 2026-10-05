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
    // ── Windows(cmd·PowerShell) — 같은 부류의 명백한 파괴·권한 상승·유출 ──
    { re: /\b(rd|rmdir)\s+(\/s\b[^&|]*\s)?(\/q\s+)?(\/s\s+)?["']?([a-z]:\\?|%(systemdrive|userprofile|homepath)%\\?)["']?(\s|$)/i, why: '드라이브·홈 대량 삭제(rd)' },
    { re: /\bdel\s+[^&|]*\/s\b[^&|]*["']?([a-z]:\\\*?|%(systemdrive|userprofile)%\\?\*?)["']?(\s|$)/i, why: '드라이브·홈 대량 삭제(del)' },
    { re: /\bremove-item\b[^;|]*-recurse\b[^;|]*\s["']?([a-z]:\\?|\$env:(userprofile|systemdrive)\\?|~\\?)["']?(\s|$)/i, why: '드라이브·홈 대량 삭제(Remove-Item)' },
    { re: /\bformat(\.com)?\s+[a-z]:/i, why: '디스크 포맷' },
    { re: /\b(diskpart|bcdedit|cipher\s+\/w)\b/i, why: '디스크·부팅 설정 변경' },
    { re: /\breg(\.exe)?\s+(delete|add)\s+["']?hk(lm|ey_local_machine)\b/i, why: '시스템 레지스트리 변경' },
    { re: /\b(runas|start-process\b[^;|]*-verb\s+runas)\b/i, why: '권한 상승(runas)' },
    { re: /\b(iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b[^|;]*\|\s*(iex|invoke-expression)\b/i, why: '원격 스크립트 직접 실행(iex)' },
    { re: /\\\.ssh\\|\\\.aws\\credentials|\bntds\.dit\b|\\config\\sam\b/i, why: '자격증명 파일 접근' },
];

/** ANSI 이스케이프 시퀀스(CSI) — 제어 문자만 지우면 `[0m` 같은 꼬리가 남아 토큰 경계를 가린다. */
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
/** 공백(탭·개행·CR)을 뺀 제어 문자. */
const CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
/** 줄 이음 — 셸은 백슬래시+개행을 지우고 앞뒤를 붙여 읽는다(`su\<개행>do` = `sudo`). */
const LINE_CONTINUATION_RE = /\\\r?\n/g;
/** `$IFS`·`${IFS}`·`${IFS:0:1}` — 기본값이 공백이라 토큰 사이 공백 대신 쓸 수 있다. */
const IFS_RE = /\$\{IFS\b[^}]*\}|\$IFS\b/g;
/** 빈 따옴표 — `su''do` 는 `sudo` 로 실행된다. */
const EMPTY_QUOTES_RE = /''|""/g;

/**
 * 차단 목록에 대기 전 정리 — 셸이 같은 명령으로 읽는 표기를 하나로 모은다.
 * 휴리스틱이다(보안 경계 아님): 백슬래시 이스케이프(`s\udo`)·내용 있는 따옴표(`s"u"do`)·변수 조립은 그대로 지나간다.
 */
export function normalizeForDenylist(cmd: string): string {
    return String(cmd)
        .replace(LINE_CONTINUATION_RE, '')
        .replace(ANSI_CSI_RE, '')
        .replace(CONTROL_CHARS_RE, '')
        .replace(IFS_RE, ' ')
        .replace(EMPTY_QUOTES_RE, '');
}

/** 원문과 정리한 문자열을 모두 댄다 — 정리가 기존 차단을 풀지 못하게 원문 판정을 그대로 둔다. */
export function matchDenylist(cmd: string): string | null {
    const raw = String(cmd);
    const normalized = normalizeForDenylist(raw);
    for (const c of normalized === raw ? [raw] : [raw, normalized]) {
        for (const d of EXEC_DENYLIST) if (d.re.test(c)) return d.why;
    }
    return null;
}
