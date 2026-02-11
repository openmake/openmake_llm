/**
 * Dynamic MCP Routing 기능 직접 테스트
 */

// TypeScript 등록
require('ts-node/register');

// 모듈 로드
const { TOOL_TIERS, canUseTool, getToolsForTier, getDefaultTierForRole } = require('./backend/api/src/mcp/tool-tiers');
const { UserSandbox, createUserContext } = require('./backend/api/src/mcp/user-sandbox');

console.log('='.repeat(50));
console.log('Dynamic MCP Routing 기능 테스트');
console.log('='.repeat(50));

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (e) {
        console.log(`❌ ${name}: ${e.message}`);
        failed++;
    }
}

function assert(condition, msg = 'Assertion failed') {
    if (!condition) throw new Error(msg);
}

// ============================================
// 1. Tool Tiers 테스트
// ============================================
console.log('\n📦 Tool Tiers 테스트');
console.log('-'.repeat(40));

test('TOOL_TIERS 설정 확인', () => {
    assert(Array.isArray(TOOL_TIERS.free), 'free tier not array');
    assert(Array.isArray(TOOL_TIERS.pro), 'pro tier not array');
    assert(Array.isArray(TOOL_TIERS.enterprise), 'enterprise tier not array');
});

test('free 등급은 web_search 포함', () => {
    assert(TOOL_TIERS.free.includes('web_search'));
});

test('enterprise 등급은 * 포함', () => {
    assert(TOOL_TIERS.enterprise.includes('*'));
});

test('canUseTool - free는 web_search 가능', () => {
    assert(canUseTool('free', 'web_search') === true);
});

test('canUseTool - free는 run_command 불가', () => {
    assert(canUseTool('free', 'run_command') === false);
});

test('canUseTool - pro는 run_command 가능', () => {
    assert(canUseTool('pro', 'run_command') === true);
});

test('canUseTool - pro는 firecrawl_* 와일드카드 매칭', () => {
    assert(canUseTool('pro', 'firecrawl_scrape') === true);
});

test('canUseTool - enterprise는 모든 도구 가능', () => {
    assert(canUseTool('enterprise', 'any_random_tool') === true);
});

test('getToolsForTier - free 필터링', () => {
    const tools = getToolsForTier('free', ['web_search', 'run_command']);
    assert(tools.includes('web_search'));
    assert(!tools.includes('run_command'));
});

test('getDefaultTierForRole - admin은 enterprise', () => {
    assert(getDefaultTierForRole('admin') === 'enterprise');
});

test('getDefaultTierForRole - user는 free', () => {
    assert(getDefaultTierForRole('user') === 'free');
});

// ============================================
// 2. User Sandbox 테스트
// ============================================
console.log('\n🔒 User Sandbox 테스트');
console.log('-'.repeat(40));

const testUserId = 'test_user_999';

test('getWorkDir 경로 생성', () => {
    const dir = UserSandbox.getWorkDir(testUserId);
    assert(dir.includes(testUserId));
    assert(dir.includes('workspace'));
});

test('getDataDir 경로 생성', () => {
    const dir = UserSandbox.getDataDir(testUserId);
    assert(dir.includes('data'));
});

test('getUserDbPath SQLite 경로', () => {
    const dbPath = UserSandbox.getUserDbPath(testUserId);
    assert(dbPath.includes('user.db'));
});

test('getUserConversationDbPath 대화 DB 경로', () => {
    const dbPath = UserSandbox.getUserConversationDbPath(testUserId);
    assert(dbPath.includes('conversations.db'));
});

test('validatePath - 외부 경로 차단', () => {
    assert(UserSandbox.validatePath(testUserId, '/etc/passwd') === false);
});

test('createUserContext 컨텍스트 생성', () => {
    const ctx = createUserContext(1, 'pro', 'user', 'org1');
    assert(ctx.userId === 1);
    assert(ctx.tier === 'pro');
    assert(ctx.role === 'user');
    assert(ctx.orgId === 'org1');
});

// ============================================
// 결과 출력
// ============================================
console.log('\n' + '='.repeat(50));
console.log(`테스트 결과: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
