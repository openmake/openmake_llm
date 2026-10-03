/**
 * 종료 코드 해석 — 0 이 아니어도 오류가 아닌 잘 알려진 경우에 뜻을 덧붙인다.
 *
 * 종전에는 0 이 아닌 코드를 모두 오류로 표시해, `grep` 이 "일치 없음"(1)을 돌려줘도 모델이 실패로 읽고
 * 같은 검색을 되풀이하거나 원인을 찾느라 턴을 썼다. 표(config/agent-task-tools 의 EXIT_CODE_MEANINGS)에
 * 있는 명령·코드만 해석하고, 어느 명령의 코드인지 확실하지 않으면 해석하지 않는다(오류 표시 유지).
 *
 * @module services/task-sandbox/exit-code
 */
import { EXIT_CODE_HINT_ENABLED, EXIT_CODE_MEANINGS } from '../../config/agent-task-tools';
import { EXIT_CODE_NOTES } from '../../prompts/agent-task-tools';

/** 따옴표 안 내용과 리다이렉션을 지운 뼈대 — 연산자를 찾기 위한 것이라 인자 값은 필요 없다. */
function skeleton(command: string): string {
    return command
        .replace(/'[^']*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/\d*>&\d+/g, ' ')
        .replace(/\d*>>?\s*\S+/g, ' ');
}

/** PURE: 덧붙일 해석 문구. 해석할 수 없으면 null — 호출부는 종전대로 오류로 표시한다. */
export function interpretExitCode(command: string, exitCode: number, enabled: boolean = EXIT_CODE_HINT_ENABLED): string | null {
    if (!enabled || exitCode === 0) return null;
    const bare = skeleton(command);
    // 명령 연결·치환·백그라운드가 있으면 어느 명령의 코드인지 알 수 없다. 단독 `|` (파이프)만 허용한다.
    if (/&&|\|\||[;\n`&]|\$\(/.test(bare)) return null;
    const words = (bare.split('|').pop() ?? '').trim().split(/\s+/).filter((w) => w.length > 0);
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    if (words.length === 0) return null;
    const base = words[0].split('/').pop() ?? '';
    const meaning = (EXIT_CODE_MEANINGS[`${base} ${words[1] ?? ''}`] ?? EXIT_CODE_MEANINGS[base])?.[exitCode];
    return meaning ? EXIT_CODE_NOTES[meaning] : null;
}
