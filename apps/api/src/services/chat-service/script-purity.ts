/**
 * @module services/chat-service/script-purity
 * @description 응답 스크립트 순수성 교정 — 한글 문장에 섞인 한자·가나 제거 (2026-08-02).
 *
 * 결함: 웹 검색·도구 결과가 외국어면 답변 언어가 그쪽으로 끌려가, 한글 문장 안에
 * 한자·중국어 간체자가 섞인다 (예: "재정支出", "开发商(개발사)", "8월 2일当天").
 * 운영 30일 assistant 502건 중 53건(10.6%), 중국·일본 관련 검색 질의만 놓고
 * 측정하면 11건 중 5건(45%).
 *
 * 프롬프트로는 해결되지 않는다 — 시스템 지시를 대상 언어로 바꾸고 프롬프트 맨 끝으로
 * 옮겨도, 도구 결과 뒤에 리마인더를 넣어도 혼입률이 내려가지 않았다(2026-08-02 A/B).
 * 이 레포의 선례("넛지·프롬프트만으론 불충분" — 카카오 지도 tool_choice 강제,
 * 웹검색 출처 결정적 첨부)와 같은 결론이라, 후단 교정으로 처리한다.
 *
 * LLM 판단 경계상 **C형(후단 판정형)** 이므로 반드시 fail-open — 교정 실패가 본
 * 응답을 훼손하지 않는다. 실측 교정 성공률 5/6.
 *
 * 설계: 응답 전체를 다시 쓰게 하지 않고 **혼입된 줄만** 교정한다. 수치·표·서식이
 * 재작성 과정에서 변형되는 위험을 없애고 토큰 비용도 줄인다. 코드 블록은 제외한다
 * (중국어 문자열 리터럴 등 의도된 한자를 건드리면 안 되므로).
 */
import { resolveRoleClientForUser } from '../model-role-resolver';
import { SCRIPT_PURITY } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ScriptPurity');

/** 한글에 바로 붙은 한자/가나 — 문장 내 혼입. 독립된 한자 인용(뉴스 제목 등)은 제외된다. */
const MIXED_SCRIPT = /[가-힣][一-鿿぀-ヿ]|[一-鿿぀-ヿ][가-힣]/;

/** 코드 블록(``` … ```) — 교정 대상에서 제외. */
const CODE_BLOCK = /```[\s\S]*?```/g;

/**
 * 모델 특수 토큰(`<|mask_start|>` 등). 교정 응답에 섞여 나오는 것이 관측돼
 * (2026-08-02 라이브 1건), 이런 줄은 채택하지 않고 원문을 지킨다.
 */
const SPECIAL_TOKEN = /<\|[^|]*\|>/;

/**
 * 한글 문장에 한자·가나가 섞였는지 판정.
 *
 * @param content - 검사할 응답 본문
 * @returns 혼입이 하나라도 있으면 true
 */
export function hasScriptMixing(content: string): boolean {
    if (!content) return false;
    return MIXED_SCRIPT.test(content.replace(CODE_BLOCK, ''));
}

/** 코드 블록 밖에서 혼입된 줄의 인덱스를 찾는다. */
function findDirtyLineIndexes(lines: string[]): number[] {
    const dirty: number[] = [];
    let inCode = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trimStart().startsWith('```')) {
            inCode = !inCode;
            continue;
        }
        if (!inCode && MIXED_SCRIPT.test(line)) dirty.push(i);
    }
    return dirty;
}

/**
 * 혼입된 줄을 한국어로 교정한다.
 *
 * @param content - 응답 본문
 * @param langCode - resolvedLanguage. 'ko' 가 아니면 교정하지 않는다(관측된 결함이 한국어 경로).
 * @param userId - role client 해석용
 * @returns 교정된 본문. 교정 불필요/실패 시 null (호출부는 원문 유지 — fail-open)
 */
export async function repairScriptMixing(
    content: string,
    langCode: string | undefined,
    userId?: string,
): Promise<string | null> {
    if (!SCRIPT_PURITY.ENABLED) return null;
    if (!content || langCode !== 'ko') return null;

    const lines = content.split('\n');
    const dirty = findDirtyLineIndexes(lines);
    if (dirty.length === 0) return null;
    if (dirty.length > SCRIPT_PURITY.MAX_LINES) {
        // 본문 대부분이 혼입이면 줄 단위 교정의 이점(서식 보존)이 사라지고 비용만 커진다.
        logger.warn(`혼입 줄 ${dirty.length}개 — 상한(${SCRIPT_PURITY.MAX_LINES}) 초과로 교정 생략`);
        return null;
    }

    try {
        const resolved = await resolveRoleClientForUser('summary', userId);
        const client = resolved.client.derive({ timeout: SCRIPT_PURITY.TIMEOUT_MS });
        const numbered = dirty.map((idx, n) => `${n + 1}. ${lines[idx]}`).join('\n');
        const r = await client.chat(
            [
                { role: 'system', content: SCRIPT_PURITY.SYSTEM_PROMPT },
                { role: 'user', content: numbered },
            ],
            { num_predict: SCRIPT_PURITY.MAX_OUTPUT_TOKENS, temperature: SCRIPT_PURITY.TEMPERATURE },
            undefined,
            { think: false },
        );
        const out = (r?.content ?? '').trim();
        if (!out) return null;

        // 응답을 "N. 내용" 으로 되받아 원래 줄에 매핑한다. 줄 수가 어긋나면 신뢰할 수 없으므로 포기.
        const repaired = new Map<number, string>();
        for (const line of out.split('\n')) {
            const m = line.match(/^\s*(\d+)\.\s?(.*)$/);
            if (!m) continue;
            const n = parseInt(m[1]!, 10) - 1;
            if (n >= 0 && n < dirty.length) repaired.set(n, m[2]!);
        }
        if (repaired.size !== dirty.length) {
            logger.warn(`교정 결과 줄 수 불일치 (기대 ${dirty.length}, 수신 ${repaired.size}) — 원문 유지`);
            return null;
        }

        const next = [...lines];
        let fixedCount = 0;
        for (let n = 0; n < dirty.length; n++) {
            const cand = repaired.get(n)!;
            // 교정본에 여전히 혼입이 있거나, 특수 토큰이 섞였거나, 내용이 뭉텅이로
            // 사라졌으면 그 줄은 원문을 지킨다.
            const original = lines[dirty[n]!]!;
            if (MIXED_SCRIPT.test(cand)) continue;
            if (SPECIAL_TOKEN.test(cand)) continue;
            if (cand.length < original.length * SCRIPT_PURITY.MIN_LENGTH_RATIO) continue;
            next[dirty[n]!] = cand;
            fixedCount++;
        }
        if (fixedCount === 0) return null;
        logger.info(`스크립트 혼입 교정 ${fixedCount}/${dirty.length}줄`);
        return next.join('\n');
    } catch (e) {
        // fail-open — 교정 실패가 본 응답을 죽이지 않는다.
        logger.warn(`교정 실패 (원문 유지): ${e instanceof Error ? e.message : String(e)}`);
        return null;
    }
}
