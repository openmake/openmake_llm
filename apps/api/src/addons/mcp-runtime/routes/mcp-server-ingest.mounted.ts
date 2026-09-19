/**
 * `/api/mcp/servers` ingest 라우터 조립 — 종전 `routes/setup.ts` 가 Base 의존성을 주입하던 것을
 * add-on 이 직접 조립한다 (2026-09-19). add-on → Base 방향 import 는 정상이다.
 *
 * @module addons/mcp-runtime/routes/mcp-server-ingest.mounted
 */
import { mcpServerIngestRouter } from './mcp-server-ingest.routes';
import { getPool } from '../../../data/models/unified-database';
import { GitFetcher } from '../../../agents/git-ingest/git-fetcher';
import { LLMClient } from '../../../llm/client';
import { MCP_INGEST } from '../../../config/constants';

const e2eMcpMock = process.env.MCP_INGEST_E2E_MOCK === 'true';
// E2E 픽스처 모드 — 실제 GitHub API 호출 회피.
// require() 로 lazy load 하여 production 번들에 mock 코드가 포함되지 않게 함.
const fetcherFactory = e2eMcpMock
    ? (() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { MockGitFetcher } = require('../../../agents/git-ingest/__mocks__/mock-git-fetcher');
        return () => new MockGitFetcher();
    })()
    : (opts: { accessToken?: string }) => new GitFetcher({
        accessToken: opts.accessToken,
        timeoutMs: MCP_INGEST.gitFetchTimeoutMs,
    });

export default mcpServerIngestRouter({
    pool: getPool(),
    fetcherFactory,
    llmClientFactory: (model: string) => new LLMClient(model ? { model } : {}),
});
