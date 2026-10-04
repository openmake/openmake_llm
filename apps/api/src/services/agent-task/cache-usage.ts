/**
 * 작업의 캐시 적중 프롬프트 토큰 누적 — 관측용(과금·한도에는 쓰지 않는다).
 *
 * 에이전트 작업은 턴마다 같은 시스템 프롬프트·도구 스키마·앞선 대화를 다시 보내므로, 모델 서버의
 * 프롬프트 캐시 적중률이 비용·지연을 좌우한다. 적중률 = 적중 토큰 / 값을 준 호출의 입력 토큰.
 * 값을 주지 않은 호출은 분모에도 넣지 않는다 — 넣으면 "모름"이 "적중 0"으로 섞여 적중률이 낮게 보인다.
 * 서버가 한 번도 값을 주지 않으면 저장할 것이 없다(칸은 NULL 로 남는다).
 */
import type { UsageMetrics } from '../../llm/types';

export interface CacheUsageSnapshot {
    cachedPromptTokens?: number;
    cacheReportedPromptTokens?: number;
}

export class CacheUsageTally {
    private cached: number | undefined;
    private reported = 0;

    /** 재개: 저장된 값에서 이어 센다. 저장된 값이 없으면(NULL) 없는 채로 둔다. */
    restore(task: { cached_prompt_tokens?: number | null; cache_reported_prompt_tokens?: number | null } | null | undefined): void {
        if (task?.cached_prompt_tokens === undefined || task.cached_prompt_tokens === null) return;
        this.cached = Number(task.cached_prompt_tokens);
        this.reported = Number(task.cache_reported_prompt_tokens ?? 0);
    }

    add(metrics: UsageMetrics | undefined): void {
        if (metrics?.cached_prompt_tokens === undefined) return;
        this.cached = (this.cached ?? 0) + metrics.cached_prompt_tokens;
        this.reported += metrics.prompt_tokens ?? 0;
    }

    /** updateAgentTask 에 펼쳐 넣을 값 — 서버가 준 적이 없으면 빈 객체. */
    snapshot(): CacheUsageSnapshot {
        return this.cached === undefined ? {} : { cachedPromptTokens: this.cached, cacheReportedPromptTokens: this.reported };
    }
}
