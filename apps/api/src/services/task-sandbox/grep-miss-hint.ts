/**
 * 검색 무일치 원인 안내 — grep_code 가 0건일 때 흔한 원인을 실제로 확인해 한 줄로 알린다.
 *
 * "일치 없음"만 받으면 모델은 없다고 결론짓거나 같은 검색을 표현만 바꿔 되풀이한다. 원인이 대소문자·
 * 이스케이프 안 된 정규식 문자·숨김 파일인 경우가 흔하므로, 조건만 바꾼 같은 검색을 돌려 **확인된** 원인만 알린다
 * (추측 문구를 붙이지 않는다). 처음 확인된 원인 하나에서 멈춘다. 전부 결정적 규칙이다(LLM 호출 없음).
 *
 * @module services/task-sandbox/grep-miss-hint
 */
import { GREP_MISS_HINTS } from '../../prompts/agent-task-tools';

/** 조건을 바꾼 검색 한 번 — 일치하는 첫 줄("파일:줄:내용"), 없으면 null. */
type Probe = (o: { pattern: string; ignoreCase: boolean; hidden?: boolean }) => Promise<string | null>;

/** 정규식 문자를 문자 그대로 찾도록 이스케이프한다. */
export function escapeRegexChars(pattern: string): string {
    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param canProbeHidden 숨김·무시 대상 파일을 건너뛰는 백엔드(rg)일 때만 true — grep 은 원래 다 본다.
 * @returns 덧붙일 문구(앞에 " — " 포함). 확인된 원인이 없으면 ''.
 */
export async function diagnoseNoMatch(
    q: { pattern: string; ignoreCase: boolean; canProbeHidden: boolean },
    probe: Probe,
): Promise<string> {
    if (!q.ignoreCase && await probe({ pattern: q.pattern, ignoreCase: true })) return GREP_MISS_HINTS.ignoreCase();
    const escaped = escapeRegexChars(q.pattern);
    if (escaped !== q.pattern && await probe({ pattern: escaped, ignoreCase: q.ignoreCase })) return GREP_MISS_HINTS.literal(escaped);
    if (q.canProbeHidden) {
        const hit = await probe({ pattern: q.pattern, ignoreCase: q.ignoreCase, hidden: true });
        if (hit) return GREP_MISS_HINTS.hidden(hit.split(':')[0]);
    }
    return '';
}
