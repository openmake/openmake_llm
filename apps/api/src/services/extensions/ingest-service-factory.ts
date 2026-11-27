/**
 * ExtensionIngestService 조립 — 확장 라우트(갤러리·카탈로그·업데이트 확인)와 카탈로그 주기 동기화가 같은 조립을 쓴다.
 *
 * 동적 import — 무거운 설치 엔진·LLM 클라이언트를 라우트 모듈 로드 시점에 끌어오지 않게(종전 컨트롤러 내부 함수를 옮긴 것).
 *
 * @module services/extensions/ingest-service-factory
 */
import { getPool } from '../../data/models/unified-database';

/** scope 가 있으면 내부 번들을 요청자 스코프(본인 소유 또는 shared 게시분)로만 읽는다 (B9-01 심층방어) */
export async function buildExtensionIngestService(scope?: { userId: string; isAdmin: boolean }) {
    const { ExtensionIngestService } = await import('../../agents/git-ingest/extension-ingest-service');
    const { GitFetcher } = await import('../../agents/git-ingest/git-fetcher');
    const { LLMClient } = await import('../../llm/client');
    const { SKILL_CREATOR } = await import('../../config/constants');
    const { MarketplaceBundleRepository } = await import('../../data/repositories/marketplace-bundle-repository');
    return new ExtensionIngestService({
        pool: getPool(),
        llmClientFactory: (model: string) => new LLMClient(model ? { model } : {}),
        fetcherFactory: (opts) => new GitFetcher({ accessToken: opts.accessToken, timeoutMs: SKILL_CREATOR.gitFetchTimeout }),
        // 갤러리에 게시된 내부 번들(internal://bundle/<id>) 설치 — DB 에서 파일을 읽는다.
        internalBundleLoader: (id) => {
            const repo = new MarketplaceBundleRepository(getPool());
            return scope && !scope.isAdmin ? repo.loadForUser(id, scope.userId) : repo.load(id);
        },
    });
}
