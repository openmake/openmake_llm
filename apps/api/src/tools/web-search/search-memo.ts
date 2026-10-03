/**
 * 검색 결과 메모 — 같은 사용자·같은 질의의 웹 검색을 짧은 시간 기억하고, 동시에 들어온 같은 질의는 한 번의 호출로 합친다.
 *
 * web_search 한 번은 등록된 모든 공급자로 퍼진다. 에이전트가 같은 질의를 되풀이하거나(재시도·하위 에이전트),
 * 병렬 도구 호출이 같은 질의를 동시에 내면 같은 호출이 그대로 반복됐다. 프로세스 메모리에만 둔다
 * (API 프로세스가 하나다 — 늘리면 프로세스마다 따로 기억할 뿐 틀린 결과를 주지는 않는다).
 *
 * 키에 사용자·조직을 넣는다 — 검색 결과 자체는 사용자별이 아니지만, 한 사용자의 질의 이력이 다른 사용자의
 * 응답 시간·결과로 드러나지 않게 범위를 나눈다.
 *
 * @module tools/web-search/search-memo
 */
import { WEB_SEARCH_MEMO } from '../../config/agent-task-browser-web';
import type { UserContext } from '../../tool-contract/types';
import type { SearchResult } from './types';

/** PURE: 메모 키 — 조직·사용자·정규화한 질의(소문자, 공백 정리). 사용자를 알 수 없으면 null(기억하지 않는다). */
export function searchMemoKey(context: Pick<UserContext, 'userId' | 'orgId'> | undefined, query: string): string | null {
    if (context?.userId === undefined || context.userId === null) return null;
    return JSON.stringify([context.orgId ?? '', String(context.userId), query.trim().toLowerCase().replace(/\s+/g, ' ')]);
}

/** 유효 시간·크기 상한이 있는 메모 + 동시 호출 합치기. 빈 배열과 실패는 기억하지 않는다. */
export class SearchMemo<T extends unknown[]> {
    /** 삽입 순서 = 오래된 순서(Map) — 상한을 넘으면 앞에서부터 버린다. */
    private readonly store = new Map<string, { expiresAt: number; value: T }>();
    private readonly inFlight = new Map<string, Promise<T>>();

    constructor(private readonly opts: { ttlMs: number; maxEntries: number; now?: () => number }) {}

    get size(): number { return this.store.size; }

    async run(key: string, fetch: () => Promise<T>): Promise<T> {
        const now = (this.opts.now ?? Date.now)();
        const hit = this.store.get(key);
        if (hit && now < hit.expiresAt) return structuredClone(hit.value);
        if (hit) this.store.delete(key);

        let pending = this.inFlight.get(key);
        if (!pending) {
            pending = fetch().then((value) => {
                if (value.length > 0) this.remember(key, value);
                return value;
            }).finally(() => { this.inFlight.delete(key); });
            this.inFlight.set(key, pending);
        }
        return structuredClone(await pending);
    }

    private remember(key: string, value: T): void {
        const now = (this.opts.now ?? Date.now)();
        for (const [k, v] of this.store) if (now >= v.expiresAt) this.store.delete(k);
        this.store.delete(key);
        this.store.set(key, { expiresAt: now + this.opts.ttlMs, value: structuredClone(value) });
        while (this.store.size > this.opts.maxEntries) this.store.delete(this.store.keys().next().value as string);
    }
}

const webSearchMemo = new SearchMemo<SearchResult[]>({ ttlMs: WEB_SEARCH_MEMO.TTL_MS, maxEntries: WEB_SEARCH_MEMO.MAX_ENTRIES });

/** web_search 도구용 — 꺼져 있거나 사용자를 알 수 없으면 그대로 검색한다. */
export function memoizedWebSearch(
    context: Pick<UserContext, 'userId' | 'orgId'> | undefined,
    query: string,
    search: () => Promise<SearchResult[]>,
): Promise<SearchResult[]> {
    const key = WEB_SEARCH_MEMO.ENABLED ? searchMemoKey(context, query) : null;
    return key === null ? search() : webSearchMemo.run(key, search);
}
