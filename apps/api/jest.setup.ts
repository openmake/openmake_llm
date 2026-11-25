/**
 * Jest globalSetup — jest.config.js 의 setupFiles 가 각 test worker 부팅 시 1회 실행.
 *
 * 목적:
 *   1. dotenv preload (.env 의 DATABASE_URL/TOKEN_ENCRYPTION_KEY 등 로드)
 *   2. NODE_ENV='test' 강제 — .env 의 NODE_ENV=production 누출 차단
 *      (token-crypto 등 production 검증 회피)
 *   3. RL_MCP_INGEST_* rate limit 테스트 한도 상향 — supertest 빠른 반복 시
 *      tier 한도 초과 방지
 *   4. 배포 구성 키(ADDON_BUILTIN_DISABLED)의 .env 누출 차단 — 아래 DOTENV_IGNORED_KEYS
 *
 * 본 파일은 apps/api/jest.config.js 의 `setupFiles` 에 등록됨.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

// .env 는 프로젝트 루트 — apps/api/jest.setup.ts 기준 ../../.env
const ENV_PATH = path.resolve(__dirname, '../../.env');
// 명령줄에서 직접 준 값은 dotenv 가 덮어쓰지 않는다 — 누출 차단 판정에 쓰려고 로드 전에 기록한다.
const PRESET_ENV_KEYS = new Set(Object.keys(process.env));
dotenv.config({ path: ENV_PATH });

// 배포 구성 키는 .env 에서 받지 않는다 — 테스트 결과가 그 장비의 운영 구성에 따라 달라지지 않게.
// 예: 로컬 .env 에 ADDON_BUILTIN_DISABLED=industry-pack,… 를 두면 팩 데이터를 전제로 한 7개 suite 가
// 실패했다(2026-11-26, CI 는 .env 가 없어 통과). 명령줄로 직접 준 값(`ADDON_BUILTIN_DISABLED=x npx jest`)은 그대로 둔다.
const DOTENV_IGNORED_KEYS = ['ADDON_BUILTIN_DISABLED'];
for (const key of DOTENV_IGNORED_KEYS) {
    if (!PRESET_ENV_KEYS.has(key)) delete process.env[key];
}

// jest 실행 시 NODE_ENV 강제 — token-crypto / config validator 가 test 모드로 작동
process.env.NODE_ENV = 'test';

// 테스트는 운영 DB 를 건드리지 않는다.
//
// UnifiedDatabase 생성자가 initSchema 를 즉시 실행하므로(data/models/unified-database.ts),
// supertest 로 앱을 띄우기만 해도 .env 의 DATABASE_URL(=운영 DB)에 DDL/DML 이 나간다.
// 실제로 부팅 좀비 정리 UPDATE 가 운영 데이터에 적용된 사례가 있다(2026-07-30 21:51 KST,
// research_sessions 4건). 의도와 결과가 우연히 일치했을 뿐 위험한 구조다.
//
// DB 가 필요한 테스트(*.db.test.ts)는 TEST_DATABASE_URL 이 없으면 스스로 describe.skip 한다. CI 의 Gate 1(npm test)은
// 변수를 주지 않아 이 경로로 스킵되고, Gate 1.5(npm run test:db)가 job 안의 일회용 PostgreSQL 을 TEST_DATABASE_URL 로 주어
// *.db.test.ts 만 돌린다(.github/workflows/ci.yml, scripts/ci/run-db-tests.mjs). 그래서 기본값은 "변수 제거"다.
// 잘못된 DB 를 가리키게 두면 변수는 존재하므로 테스트가 실행돼 연결 오류로 실패한다.
//
// TEST_DATABASE_URL 이 있으면 아래에서 DATABASE_URL 을 그 값으로 덮어쓴다 — getPool() 을 쓰는 코드(Base 데이터 포트 포함)도
// 같은 테스트 DB 를 본다. 이때 jest.setup-after-env.ts 의 pg 차단도 풀리므로 전체 `npm test` 에 변수를 주면 단위 테스트도
// 실 DB 에 붙는다 — DB 테스트는 `npm run test:db` 로 돌린다. 준비: scripts/setup-test-db.sh.
// ⚠️ 운영 DB 를 넣지 말 것 — 스키마 초기화가 그대로 적용된다.
if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
    delete process.env.DATABASE_URL;
}

// 단위 테스트는 실 Redis 에 쓰지 않는다 — .env 의 STORAGE_BACKEND=redis 누출 차단.
//
// 리미터·쿼터 등이 getKeyValueStore() 로 실 Redis 에 쓰면 카운터가 실행 사이에 남아,
// metrics-exposition.test.ts 같은 한도 테스트가 1분 안에 다시 돌리면 한도 전에 429 를 받는다.
// 실 Redis 통합은 __tests__/redis-store.test.ts 가 TEST_REDIS_URL 가드로 따로 돈다.
// REDIS_URL 은 건드리지 않는다(storage-factory.test.ts 는 스스로 env 를 설정해 Redis 분기를 검사한다).
process.env.STORAGE_BACKEND = 'memory';

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
