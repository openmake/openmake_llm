/**
 * ============================================================
 * CoT Extractor — 평문 chain-of-thought 를 thinking 채널로 분리
 * ============================================================
 *
 * Qwen3.6 / DeepSeek-R1 같은 reasoning 모델이 `<think>` 태그 없이 평문으로
 * chain-of-thought 를 출력할 때의 안전망. vLLM 의 `--reasoning-parser` flag
 * 가 서버에 미설정인 환경에서 사용자에게 raw CoT 가 노출되는 것을 차단.
 *
 * 감지 규칙:
 *   1. 응답 시작에 "Here's a thinking process", "Let me think", "Analyze",
 *      "Self-Correction" 같은 영문 CoT sentinel
 *   2. 한국어 결론 마커: "현재 ", "답변:", "결론:", "[Output]", "Final:" 등
 *   3. sentinel 발견 + 결론 마커 발견 → 결론만 추출, 나머지는 thinking
 *
 * 한계:
 *   - heuristic — false-positive 가능 (CoT 가 아닌 응답이 우연히 패턴 일치)
 *   - 결론 마커가 없으면 마지막 한국어 문장만 추출
 *
 * @module llm/cot-extractor
 * @see llm/stream-parser.ts (final cleanup 단계에서 호출)
 */

/** CoT 시작 sentinel — 응답 시작에 이런 패턴이 보이면 CoT 출력 의심 */
const COT_START_SENTINELS = [
    /^Here's a thinking process[:\s]/i,
    /^Let me think (step by step|carefully|through this)/i,
    /^Let's (think|analyze|break this down)/i,
    /^Analyze (User Input|the question)/i,
    /^Step\s*\d+:/im,
    /^Thought process[:\s]/i,
    /^Reasoning[:\s]/i,
    /^Thinking[:\s]/i,
    /^Self-Correction\/Refinement/i,
];

/** 결론 마커 — sentinel 발견 시 이 마커 이후가 실제 답변.
 *  주의: [Done.], "All good", "Proceeds" 같은 메타 종료 마커는 결론 마커가 아니므로 제외.
 *  답변 본문이 따라오는 마커만 포함. */
const ANSWER_MARKERS = [
    /\[Output\]\s*\n?/i,        // claude.ai 식 [Output] 표기
    /Final Answer[:\s]+/i,
    /Final Output[:\s]+(?!Generation)/i, // "Final Output Generation" 제외
    /^Output[:\s]+/im,           // 줄 시작 Output: (자유 본문 안 매칭 피함)
    /^Draft[:\s]+/im,
    /^Final[:\s]+(?!check)/im,   // "Final check" 제외 (메타 라인)
    /^Response[:\s]+/im,
    /^Answer[:\s]+/im,
    /최종 답변[:\s]*\n?/i,
    /^답변[:\s]+/im,
    /^결론[:\s]+/im,
];

/** 한국어 결론 시작 휴리스틱 — Korean 글자가 있는 첫 문장 */
const KOREAN_LINE_RE = /^[^\n]*[가-힣][^\n]*$/m;

export interface CotExtractResult {
    detected: boolean;
    answer: string;
    thinking: string;
}

/**
 * 응답 content 에서 CoT 와 실제 답변 분리.
 *
 * 알고리즘:
 *   1. content 의 처음 200자 안에 COT_START_SENTINELS 매칭? 아니면 detected=false
 *   2. 매칭되면 끝부분에서 ANSWER_MARKERS 검색 (역순 우선 — 가장 마지막 마커 사용)
 *   3. 마커 발견 시 마커 이후 ~ 끝 = answer, 그 앞 = thinking
 *   4. 마커 없으면 → 마지막 비어있지 않은 한국어 줄 = answer, 나머지 = thinking
 */
export function extractCoTFromContent(content: string): CotExtractResult {
    if (!content || content.length < 100) {
        return { detected: false, answer: content, thinking: '' };
    }
    const prefix = content.slice(0, 400);
    const sentinelHit = COT_START_SENTINELS.some(re => re.test(prefix));
    if (!sentinelHit) {
        return { detected: false, answer: content, thinking: '' };
    }

    // 끝부분에서 결론 마커 — 마지막 매칭 우선 (sliding scan 의 마지막 인덱스)
    let lastAnswerStart = -1;
    let lastMarkerLen = 0;
    for (const re of ANSWER_MARKERS) {
        const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        let m;
        while ((m = globalRe.exec(content)) !== null) {
            if (m.index > lastAnswerStart) {
                lastAnswerStart = m.index;
                lastMarkerLen = m[0].length;
            }
            // ANSWER_MARKERS 에는 'g' 가 없는 case 위해 무한 루프 방지
            if (!globalRe.global) break;
        }
    }

    if (lastAnswerStart >= 0) {
        const thinking = content.slice(0, lastAnswerStart).trim();
        const answerPart = content.slice(lastAnswerStart + lastMarkerLen).trim();
        // 마지막 비어있지 않은 한국어 줄만 — markdown/메타 문장 제거
        const answer = pickFinalAnswerLine(answerPart);
        return { detected: true, answer, thinking };
    }

    // 마커 없음 — 마지막 한국어 줄 추출
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let finalLineIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (KOREAN_LINE_RE.test(lines[i]) && !/^(Output|Final|Done|Note|Self|Verify|Check|Constraint)/i.test(lines[i])) {
            finalLineIdx = i;
            break;
        }
    }
    if (finalLineIdx >= 0) {
        const answer = lines[finalLineIdx];
        const thinking = lines.slice(0, finalLineIdx).join('\n').trim();
        return { detected: true, answer, thinking };
    }
    // 한국어 줄도 못 찾음 — 마지막 줄 fallback
    return {
        detected: true,
        answer: lines[lines.length - 1] || '',
        thinking: lines.slice(0, -1).join('\n').trim(),
    };
}

/**
 * answerPart 에서 markdown/메타 문장 제거 후 가장 의미 있는 답변 줄 추출.
 * 보통 sentinel 다음에 "현재 ... 입니다." 같은 한 줄만 옴 — 그것만 반환.
 */
function pickFinalAnswerLine(answerPart: string): string {
    if (!answerPart) return '';
    const lines = answerPart.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // 메타성 라인 (괄호 안 노트, "All good", "Proceeds", "Done" 등) 제거
    const META_RE = /^(\(Note|All|Proceed|Done|Verify|Output matches|Final check|Self-Correction|\[|✅|→)/i;
    const filtered = lines.filter(l => !META_RE.test(l));
    if (filtered.length === 0) return lines.join('\n');
    // 가장 긴 줄을 final answer 로 — 보통 결론이 가장 충실
    return filtered.reduce((a, b) => (b.length > a.length ? b : a), filtered[0]);
}
