/**
 * Jest globalSetup — jest.config.js 의 setupFiles 가 각 test worker 부팅 시 1회 실행.
 *
 * 목적:
 *   1. dotenv preload (.env 의 DATABASE_URL/TOKEN_ENCRYPTION_KEY 등 로드)
 *   2. NODE_ENV='test' 강제 — .env 의 NODE_ENV=production 누출 차단
 *      (token-crypto 등 production 검증 회피)
 *   3. RL_MCP_INGEST_* rate limit 테스트 한도 상향 — supertest 빠른 반복 시
 *      tier 한도 초과 방지
 *
 * 본 파일은 backend/api/jest.config.js 의 `setupFiles` 에 등록됨.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

// .env 는 프로젝트 루트 — backend/api/jest.setup.ts 기준 ../../.env
const ENV_PATH = path.resolve(__dirname, '../../.env');
dotenv.config({ path: ENV_PATH });

// jest 실행 시 NODE_ENV 강제 — token-crypto / config validator 가 test 모드로 작동
process.env.NODE_ENV = 'test';

// RL_MCP_INGEST 테스트 한도 상향 (supertest 반복 호출 대응)
process.env.RL_MCP_INGEST_FREE = process.env.RL_MCP_INGEST_FREE && process.env.RL_MCP_INGEST_FREE !== '5'
    ? process.env.RL_MCP_INGEST_FREE
    : '999';
process.env.RL_MCP_INGEST_PRO = process.env.RL_MCP_INGEST_PRO && process.env.RL_MCP_INGEST_PRO !== '15'
    ? process.env.RL_MCP_INGEST_PRO
    : '999';
process.env.RL_MCP_INGEST_ENTERPRISE = process.env.RL_MCP_INGEST_ENTERPRISE && process.env.RL_MCP_INGEST_ENTERPRISE !== '50'
    ? process.env.RL_MCP_INGEST_ENTERPRISE
    : '999';
process.env.RL_MCP_INGEST_ADMIN = process.env.RL_MCP_INGEST_ADMIN && process.env.RL_MCP_INGEST_ADMIN !== '50'
    ? process.env.RL_MCP_INGEST_ADMIN
    : '999';
