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
 * 본 파일은 apps/api/jest.config.js 의 `setupFiles` 에 등록됨.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

// .env 는 프로젝트 루트 — apps/api/jest.setup.ts 기준 ../../.env
const ENV_PATH = path.resolve(__dirname, '../../.env');
dotenv.config({ path: ENV_PATH });

// jest 실행 시 NODE_ENV 강제 — token-crypto / config validator 가 test 모드로 작동
process.env.NODE_ENV = 'test';

// 테스트는 운영 DB 를 건드리지 않는다.
//
// UnifiedDatabase 생성자가 initSchema 를 즉시 실행하므로(data/models/unified-database.ts),
// supertest 로 앱을 띄우기만 해도 .env 의 DATABASE_URL(=운영 DB)에 DDL/DML 이 나간다.
// 실제로 부팅 좀비 정리 UPDATE 가 운영 데이터에 적용된 사례가 있다(2026-07-30 21:51 KST,
// research_sessions 4건). 의도와 결과가 우연히 일치했을 뿐 위험한 구조다.
//
// DB 가 필요한 테스트는 DATABASE_URL 부재 시 스스로 describe.skip 한다(.github/workflows/ci.yml
// 참고 — CI 는 변수를 아예 주지 않아 이 경로로 스킵된다). 그래서 기본값은 "변수 제거"다.
// 잘못된 DB 를 가리키게 두면 변수는 존재하므로 테스트가 실행돼 연결 오류로 실패한다.
//
// 로컬에서 DB 통합 테스트까지 돌리려면 TEST_DATABASE_URL 에 전용 DB 를 지정한다.
// ⚠️ 운영 DB 를 넣지 말 것 — 스키마 초기화가 그대로 적용된다.
if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
    delete process.env.DATABASE_URL;
}

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
