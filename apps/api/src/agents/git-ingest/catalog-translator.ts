/**
 * 카탈로그 플러그인 설명 한국어 배치 번역 (C형 후단 처리 — fail-open).
 *
 * 동기화 시점에 스냅샷 plugins 의 description 을 한국어로 번역해 description_ko 로
 * 채운다. 이전 스냅샷과 (name, description) 이 동일한 항목은 기존 번역을 재사용해
 * 재동기화 시 신규/변경분만 LLM 을 호출한다. 배치/전체 실패는 경고 로그 후 건너뜀
 * — 번역 실패가 동기화 자체를 죽이지 않는다 (UI 는 원문 fallback).
 *
 * @module agents/git-ingest/catalog-translator
 */
import type { LLMClient } from '../../llm/client';
import type { ChatMessage } from '../../llm/types';
import { createLogger } from '../../utils/logger';
import { EXTENSION_INGEST } from '../../config/constants';
import type { CatalogSnapshot } from './catalog-snapshot';

const logger = createLogger('CatalogTranslator');

const SYSTEM_PROMPT = `당신은 개발 도구 문서 번역가입니다. 플러그인의 영어 설명을 자연스러운 한국어로 번역하세요.
- 제품/브랜드명과 기술 용어(MCP, API, SDK, CLI 등)는 원문을 유지
- 마케팅 수사는 덜어내고 "무엇을 해주는 도구인지" 기능 중심으로 간결하게
- 입력은 JSON 배열이며, 각 원소를 같은 순서로 번역

## 응답 형식
JSON object only. 다른 텍스트 출력 금지.
{ "translations": ["<첫 번째 번역>", "<두 번째 번역>", ...] }
입력 배열과 반드시 같은 개수·같은 순서.`;

/** 이전 스냅샷 번역 재사용 키 */
function cacheKey(name: string, description: string): string {
    return `${name}\u0000${description}`;
}

/**
 * plugins 를 제자리 변경(mutate)해 description_ko 를 채운다.
 * @param previous 직전 스냅샷 plugins — (name, description) 일치 시 번역 재사용
 */
export async function translateCatalogDescriptions(
    llm: Pick<LLMClient, 'chat'>,
    plugins: CatalogSnapshot['plugins'],
    previous?: Array<{ name: string; description?: string; description_ko?: string }>,
): Promise<{ reused: number; translated: number; failed: number }> {
    const prevMap = new Map<string, string>();
    for (const p of previous ?? []) {
        if (p.description && p.description_ko) prevMap.set(cacheKey(p.name, p.description), p.description_ko);
    }

    const targets: Array<CatalogSnapshot['plugins'][number]> = [];
    let reused = 0;
    for (const p of plugins) {
        if (!p.description) continue;
        const cached = prevMap.get(cacheKey(p.name, p.description));
        if (cached) { p.description_ko = cached; reused++; continue; }
        targets.push(p);
    }

    let translated = 0;
    let failed = 0;
    const batchSize = EXTENSION_INGEST.translateBatchSize;
    for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize);
        try {
            const messages: ChatMessage[] = [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: JSON.stringify(batch.map(p => p.description)) },
            ];
            const resp = await llm.chat(messages);
            const raw = (resp.content ?? '').trim();
            const fence = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
            const parsed = JSON.parse(fence ? fence[1] : raw) as { translations?: unknown };
            const arr = Array.isArray(parsed.translations) ? parsed.translations : null;
            if (!arr || arr.length !== batch.length) {
                throw new Error(`번역 개수 불일치: ${arr?.length ?? 'null'} != ${batch.length}`);
            }
            for (let j = 0; j < batch.length; j++) {
                const tr = arr[j];
                if (typeof tr === 'string' && tr.trim()) { batch[j].description_ko = tr.trim(); translated++; }
                else failed++;
            }
        } catch (e) {
            failed += batch.length;
            logger.warn(`카탈로그 번역 배치 실패 (${i}-${i + batch.length}): ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    if (reused + translated + failed > 0) {
        logger.info(`카탈로그 번역: 재사용 ${reused} · 신규 ${translated} · 실패 ${failed}`);
    }
    return { reused, translated, failed };
}
