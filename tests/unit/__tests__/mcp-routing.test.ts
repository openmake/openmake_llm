/**
 * Dynamic MCP Routing 기능 테스트
 * 
 * 테스트 항목:
 * 1. UserTier 연계
 * 2. tool-tiers (등급별 도구 접근)
 * 3. user-sandbox (사용자 데이터 격리)
 */

import { UserTier, PublicUser } from '../../../backend/api/src/data/user-manager';
import { TOOL_TIERS, canUseTool, getToolsForTier, getDefaultTierForRole } from '../../../backend/api/src/mcp/tool-tiers';
import { UserSandbox, UserContext, createUserContext } from '../../../backend/api/src/mcp/user-sandbox';

// ============================================
// 1. Tool Tiers 테스트
// ============================================

describe('Tool Tiers', () => {
    describe('TOOL_TIERS 설정', () => {
        it('free 등급은 기본 도구만 포함', () => {
            expect(TOOL_TIERS.free).toContain('web_search');
            expect(TOOL_TIERS.free).toContain('vision_ocr');
            expect(TOOL_TIERS.free).not.toContain('run_command');
        });

        it('pro 등급은 고급 도구 포함', () => {
            expect(TOOL_TIERS.pro).toContain('run_command');
            expect(TOOL_TIERS.pro).toContain('firecrawl_*');
        });

        it('enterprise 등급은 모든 도구 허용', () => {
            expect(TOOL_TIERS.enterprise).toContain('*');
        });
    });

    describe('canUseTool', () => {
        it('free 사용자는 web_search 사용 가능', () => {
            expect(canUseTool('free', 'web_search')).toBe(true);
        });

        it('free 사용자는 run_command 사용 불가', () => {
            expect(canUseTool('free', 'run_command')).toBe(false);
        });

        it('pro 사용자는 run_command 사용 가능', () => {
            expect(canUseTool('pro', 'run_command')).toBe(true);
        });

        it('pro 사용자는 firecrawl_* 와일드카드 매칭', () => {
            expect(canUseTool('pro', 'firecrawl_scrape')).toBe(true);
            expect(canUseTool('pro', 'firecrawl_crawl')).toBe(true);
        });

        it('enterprise 사용자는 모든 도구 사용 가능', () => {
            expect(canUseTool('enterprise', 'web_search')).toBe(true);
            expect(canUseTool('enterprise', 'run_command')).toBe(true);
            expect(canUseTool('enterprise', 'any_random_tool')).toBe(true);
        });
    });

    describe('getToolsForTier', () => {
        const allTools = ['web_search', 'vision_ocr', 'run_command', 'firecrawl_scrape', 'secret_tool'];

        it('free 등급은 허용된 도구만 반환', () => {
            const tools = getToolsForTier('free', allTools);
            expect(tools).toContain('web_search');
            expect(tools).toContain('vision_ocr');
            expect(tools).not.toContain('run_command');
        });

        it('enterprise 등급은 모든 도구 반환', () => {
            const tools = getToolsForTier('enterprise', allTools);
            expect(tools).toEqual(allTools);
        });
    });

    describe('getDefaultTierForRole', () => {
        it('admin은 enterprise tier', () => {
            expect(getDefaultTierForRole('admin')).toBe('enterprise');
        });

        it('user는 free tier', () => {
            expect(getDefaultTierForRole('user')).toBe('free');
        });

        it('guest는 free tier', () => {
            expect(getDefaultTierForRole('guest')).toBe('free');
        });
    });
});

// ============================================
// 2. User Sandbox 테스트
// ============================================

describe('User Sandbox', () => {
    const testUserId = 'test_user_123';

    describe('경로 생성', () => {
        it('작업 디렉토리 경로 생성', () => {
            const workDir = UserSandbox.getWorkDir(testUserId);
            expect(workDir).toContain(testUserId);
            expect(workDir).toContain('workspace');
        });

        it('데이터 디렉토리 경로 생성', () => {
            const dataDir = UserSandbox.getDataDir(testUserId);
            expect(dataDir).toContain(testUserId);
            expect(dataDir).toContain('data');
        });

        it('SQLite DB 경로 생성', async () => {
            const dbPath = await UserSandbox.getUserDbPath(testUserId);
            expect(dbPath).toContain(testUserId);
            expect(dbPath).toContain('user.db');
        });

        it('대화 DB 경로 생성', async () => {
            const dbPath = await UserSandbox.getUserConversationDbPath(testUserId);
            expect(dbPath).toContain('conversations.db');
        });
    });

    describe('경로 검증 (보안)', () => {
        it('사용자 디렉토리 내 경로는 허용', () => {
            const userRoot = UserSandbox.getWorkDir(testUserId);
            const validPath = `${userRoot}/test.txt`;
            expect(UserSandbox.validatePath(testUserId, validPath)).toBe(true);
        });

        it('사용자 디렉토리 외부 접근 차단', () => {
            expect(UserSandbox.validatePath(testUserId, '/etc/passwd')).toBe(false);
            expect(UserSandbox.validatePath(testUserId, '/root/.ssh')).toBe(false);
        });

        it('상대 경로 탈출 시도 차단', () => {
            const result = UserSandbox.resolvePath(testUserId, '../../../etc/passwd');
            // 경로 탈출 시 null 반환
            expect(result === null || !result.includes('/etc/passwd')).toBe(true);
        });
    });

    describe('사용자 컨텍스트', () => {
        it('컨텍스트 생성', () => {
            const context = createUserContext(1, 'pro', 'user', 'org123');
            expect(context.userId).toBe(1);
            expect(context.tier).toBe('pro');
            expect(context.role).toBe('user');
            expect(context.orgId).toBe('org123');
        });
    });
});

// ============================================
// 테스트 실행
// ============================================

console.log('테스트 시작...');
