/**
 * 확장 설치 기준선(G0, 확장 마켓플레이스 남은 개발계획 v3.4 §6) — 마켓플레이스 작업 전에 **현재 동작을 고정**한다.
 *
 * 실제 Postgres(TEST_DATABASE_URL — 일회용 DB 전용, 없으면 skip)에서 ExtensionIngestService 를 처음부터 끝까지 돌린다.
 * 네트워크는 쓰지 않는다 — 저장소는 메모리 fetcher, ConventionChecker LLM 은 "문제 없음" 고정 응답.
 *
 * 보안 플래그 2개(#1996, 206)의 ON/OFF 4조합마다 같은 시나리오를 돌려 관찰값을 golden fixture
 * (`fixtures/extension-g0-baseline.json`)와 대조한다:
 *   ① 신규 설치(v1)  ② 사용자 승인(승인함과 같은 상태 전이)  ③ 같은 커밋 재설치  ④ 다른 소스 동명 설치(충돌)
 *   ⑤ 업데이트(v2 — 스킬 1개 그대로·1개 본문 변경·1개 추가, 에이전트 프롬프트 변경, 권한 1개 추가)  ⑥ 제거
 *
 * ⚠️ fixture 는 "옳은 동작" 이 아니라 **G0 시점의 동작** 이다. 의도한 변경일 때만
 *    `OMK_G0_UPDATE_FIXTURE=1` 로 다시 쓰고(대조 대신 기록) PR 에 이유를 적는다.
 *    마켓플레이스 B0 의 관리 설치 경로는 이 legacy 동작을 바꾸지 않아야 한다(플래그 OFF 회귀 0).
 *
 * G0 시점에 고정된 눈여겨볼 동작(fixture 에서 읽을 수 있다):
 *  - 같은 커밋 재설치는 업데이트 판정(upToDate) 전에 중복 설치 창(dedupe)에 걸려 `deduped:true` 로 끝난다.
 *  - 플래그 둘 다 OFF 면 내용이 바뀐 스킬(beta)도 이름만 같으면 승인을 이어받는다. FINGERPRINT 면 draft 로 돌아간다.
 *  - AGENT_APPROVAL 만 켜면 프롬프트가 바뀐 에이전트도 이름이 같아 승인을 이어받는다. 둘 다 켜야 pending 으로 남는다.
 *  - MCP 서버는 플래그와 무관하게 업데이트마다 draft(재승인), 권한 추가분은 `review_required` 로 막힌다.
 */
import { Pool } from 'pg';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ExtensionIngestService } from '../../agents/git-ingest/extension-ingest-service';
import type { GitFetcher, TreeEntry } from '../../agents/git-ingest/git-fetcher';
import type { LLMClient } from '../../llm/client';
import { UserExtensionRepository } from '../../data/repositories/user-extension-repository';
import { removeExtensionInstallation } from '../../services/addon/addon-state';

const CONN = process.env.TEST_DATABASE_URL;
// 설치 상태 표 기록(recordExtensionInstallation)·제거가 쓰는 전역 풀도 같은 테스트 DB 로
let mockPool: Pool;
jest.mock('../../data/models/unified-database', () => ({
    getPool: () => mockPool,
    getUnifiedDatabase: () => ({ getPool: () => mockPool }),
}));
const describeOrSkip = CONN ? describe : describe.skip;
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'extension-g0-baseline.json');
const UPDATE_FIXTURE = process.env.OMK_G0_UPDATE_FIXTURE === '1';

const FLAGS = ['EXTENSION_APPROVAL_FINGERPRINT', 'EXTENSION_AGENT_APPROVAL_REQUIRED'] as const;
const ORIGINAL_FLAGS = Object.fromEntries(FLAGS.map(k => [k, process.env[k]]));

// ── 고정 저장소 내용 ────────────────────────────────────────────────────────────
const skillMd = (name: string, body: string) =>
    `---\nname: ${name}\ndescription: G0 기준선 스킬 ${name}\n---\n\n# ${name}\n\n${body}\n`;
const agentMd = (prompt: string) =>
    `---\nname: reviewer\ndescription: G0 기준선 리뷰어\n---\n${prompt}\n`;
const pluginJson = (version: string) =>
    JSON.stringify({ name: 'g0-pack', version, description: 'G0 기준선 확장' });
const addonJson = (version: string, permissions: string[]) =>
    JSON.stringify({ id: 'g0-pack', name: 'G0 Pack', version, requires: { openmake: '>=1.0.0 <99.0.0' }, scope: 'user', components: {}, permissions });
const MCP_JSON = JSON.stringify({ mcpServers: { tool: { command: 'npx', args: ['-y', 'g0-fixture-mcp@1.0.0'] } } });

const V1: Record<string, string> = {
    '.claude-plugin/plugin.json': pluginJson('1.0.0'),
    'openmake-addon.json': addonJson('1.0.0', ['network:internet']),
    'skills/alpha/SKILL.md': skillMd('alpha', '알파 본문은 바뀌지 않는다.'),
    'skills/beta/SKILL.md': skillMd('beta', '베타 본문 v1.'),
    'agents/reviewer.md': agentMd('너는 꼼꼼한 코드 리뷰어다. 변경을 검토한다.'),
    '.mcp.json': MCP_JSON,
};
const V2: Record<string, string> = {
    ...V1,
    '.claude-plugin/plugin.json': pluginJson('1.1.0'),
    'openmake-addon.json': addonJson('1.1.0', ['network:internet', 'database:addon']),
    'skills/beta/SKILL.md': skillMd('beta', '베타 본문 v2 — 내용이 바뀌었다.'),
    'skills/gamma/SKILL.md': skillMd('gamma', '감마는 v2 에서 새로 생겼다.'),
    'agents/reviewer.md': agentMd('너는 보안 중심 코드 리뷰어다. 위험한 변경을 먼저 본다.'),
};
const SHA_V1 = 'a'.repeat(40);
const SHA_V2 = 'b'.repeat(40);

/** 메모리 저장소 — `head` 가 가리키는 커밋을 HEAD 로 resolve 한다 */
class MemoryRepoFetcher {
    head = SHA_V1;
    readonly commits: Record<string, Record<string, string>> = { [SHA_V1]: V1, [SHA_V2]: V2 };
    async resolveRef(_o: string, _r: string, ref: string): Promise<string> {
        return ref === 'HEAD' ? this.head : ref;
    }
    async listTree(_o: string, _r: string, sha: string) {
        const files = this.commits[sha];
        if (!files) throw new Error(`unknown sha ${sha}`);
        const entries: TreeEntry[] = Object.entries(files).map(([path, c]) => ({
            path, type: 'blob', size: Buffer.byteLength(c), sha: crypto.createHash('sha1').update(c).digest('hex'),
        } as TreeEntry));
        return { sha, entries, truncated: false, rateLimitRemaining: 5000 };
    }
    async fetchFile(_o: string, _r: string, sha: string, path: string): Promise<string> {
        const c = this.commits[sha]?.[path];
        if (c === undefined) throw new Error(`FILE_NOT_FOUND ${path}`);
        return c;
    }
}

const NO_FINDINGS_LLM = {
    chat: async () => ({ content: JSON.stringify({ findings: [] }), metrics: { completion_tokens: 1 } }),
} as unknown as LLMClient;

/** 경고 문자열 → 코드(콜론 앞) 정렬 목록 */
const codes = (warnings: readonly string[] = []) => [...new Set(warnings.map(w => w.split(':')[0]))].sort();

interface ScenarioObservation {
    install: unknown;
    reinstallSameCommit: unknown;
    conflictOtherSource: string;
    update: unknown;
    remove: unknown;
}

describeOrSkip('확장 설치 기준선 G0 (보안 플래그 4조합)', () => {
    let pool: Pool;
    const createdUsers: string[] = [];
    const recorded: Record<string, ScenarioObservation> = {};
    const golden = (JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as { combos: Record<string, ScenarioObservation> }).combos;

    beforeAll(() => {
        pool = new Pool({ connectionString: CONN, max: 4 });
        mockPool = pool;
    });

    afterAll(async () => {
        for (const [k, v] of Object.entries(ORIGINAL_FLAGS)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        if (createdUsers.length > 0) {
            // 확장 행 id 로 설치 상태 표 행을 지운 뒤 사용자를 지운다(구성요소·확장은 CASCADE)
            await pool.query(
                `DELETE FROM addon_installations WHERE addon_id IN (SELECT 'ext:' || id FROM user_extensions WHERE user_id = ANY($1::text[]))`,
                [createdUsers],
            );
            await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [createdUsers]);
        }
        await pool?.end();
        if (UPDATE_FIXTURE && Object.keys(recorded).length === 4) {
            const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as { _comment: string };
            fs.writeFileSync(FIXTURE_PATH, JSON.stringify({ _comment: fixture._comment, combos: recorded }, null, 2) + '\n');
        }
    });

    async function newUser(tag: string): Promise<string> {
        const id = `g0-${tag}-${crypto.randomUUID().slice(0, 8)}`;
        await pool.query(
            `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`,
            [id, id],
        );
        createdUsers.push(id);
        return id;
    }

    /** 구성요소 상태 — 이름 기준(id 는 실행마다 다르다) */
    async function componentsOf(userId: string) {
        const skills = await pool.query<{ name: string; status: string; linked: boolean }>(
            `SELECT name, status, extension_id IS NOT NULL AS linked FROM agent_skills WHERE created_by=$1 ORDER BY name, status, linked`,
            [userId],
        );
        const agents = await pool.query<{ name: string; is_active: boolean; approval_status: string; linked: boolean }>(
            `SELECT CASE WHEN name LIKE '%-archived-%' THEN regexp_replace(name, '-archived-[0-9a-f]{6}$', '-archived') ELSE name END AS name,
                    is_active, approval_status, extension_id IS NOT NULL AS linked
               FROM user_agents WHERE user_id=$1 ORDER BY 1, is_active`,
            [userId],
        );
        const mcp = await pool.query<{ status: string; enabled: boolean; sandbox_network: string | null; linked: boolean }>(
            `SELECT status, enabled, sandbox_network, extension_id IS NOT NULL AS linked FROM mcp_servers WHERE user_id=$1 ORDER BY status`,
            [userId],
        );
        const ext = await pool.query<{ status: string; version: string; permission_state: string; permissions_granted: unknown; permissions_requested: unknown; installation: boolean }>(
            `SELECT e.status, e.version, e.permission_state, e.permissions_granted, e.permissions_requested,
                    EXISTS (SELECT 1 FROM addon_installations a WHERE a.addon_id = 'ext:' || e.id) AS installation
               FROM user_extensions e WHERE e.user_id=$1 ORDER BY e.created_at`,
            [userId],
        );
        return { skills: skills.rows, agents: agents.rows, mcp: mcp.rows, extensions: ext.rows };
    }

    /** 승인함 승인과 같은 상태 전이 — 스킬 draft→active, 에이전트 pending→approved */
    async function approveAll(userId: string) {
        await pool.query(`UPDATE agent_skills SET status='active' WHERE created_by=$1 AND status='draft'`, [userId]);
        await pool.query(`UPDATE user_agents SET approval_status='approved' WHERE user_id=$1 AND approval_status='pending'`, [userId]);
    }

    function shapeResult(r: Awaited<ReturnType<ExtensionIngestService['import']>>) {
        if ('selectionRequired' in r && r.selectionRequired) return { selectionRequired: true };
        const x = r as Exclude<typeof r, { selectionRequired: true }> & { upToDate?: boolean; updated?: boolean; previousVersion?: string };
        return {
            status: x.status, version: x.version, deduped: x.deduped,
            upToDate: x.upToDate ?? false, updated: x.updated ?? false, previousVersion: x.previousVersion ?? null,
            skills: (x.skills ?? []).map(s => s.name).sort(),
            mcpServers: (x.mcpServers ?? []).filter(m => m.serverId).length,
            agents: (x.agents ?? []).filter(a => a.agentId).length,
            codes: codes(x.validationWarnings),
        };
    }

    async function runScenario(tag: string): Promise<ScenarioObservation> {
        const userId = await newUser(tag);
        const fetcher = new MemoryRepoFetcher();
        const svc = new ExtensionIngestService({
            pool,
            llmClientFactory: () => NO_FINDINGS_LLM,
            fetcherFactory: () => fetcher as unknown as GitFetcher,
        });
        const GIT_URL = 'https://github.com/g0-fixture/g0-pack';

        // ① 신규 설치
        const installed = await svc.import({ userId, isAdmin: false, gitUrl: GIT_URL });
        const install = { result: shapeResult(installed), db: await componentsOf(userId) };

        // ② 승인
        await approveAll(userId);

        // ③ 같은 커밋 재설치
        const again = await svc.import({ userId, isAdmin: false, gitUrl: GIT_URL });
        const reinstallSameCommit = { result: shapeResult(again), db: await componentsOf(userId) };

        // ④ 다른 소스 동명
        let conflictOtherSource = 'no-error';
        try {
            await svc.import({ userId, isAdmin: false, gitUrl: 'https://github.com/other-owner/g0-pack' });
        } catch (err) {
            conflictOtherSource = (err instanceof Error ? err.message : String(err)).split(':')[0];
        }

        // ⑤ 업데이트
        fetcher.head = SHA_V2;
        const updated = await svc.import({ userId, isAdmin: false, gitUrl: GIT_URL });
        const update = { result: shapeResult(updated), db: await componentsOf(userId) };

        // ⑥ 제거 — 컨트롤러 DELETE /:id 와 같은 순서(repo.remove → 설치 상태 표 행 삭제)
        const extId = (updated as { extensionId: string }).extensionId;
        const repo = new UserExtensionRepository(pool);
        const removed = await repo.remove(extId, userId, false);
        await removeExtensionInstallation(extId);
        const otherUserRemove = await repo.remove(extId, await newUser(`${tag}-other`), false);
        const remove = { removed: removed?.status ?? null, otherUserRemove: otherUserRemove?.status ?? null, db: await componentsOf(userId) };

        return { install, reinstallSameCommit, conflictOtherSource, update, remove };
    }

    const COMBOS: Array<{ fp: boolean; agent: boolean }> = [
        { fp: false, agent: false }, { fp: true, agent: false }, { fp: false, agent: true }, { fp: true, agent: true },
    ];

    it.each(COMBOS)('fp=$fp agent=$agent — 설치·재설치·충돌·업데이트·제거가 golden 과 같다', async ({ fp, agent }) => {
        process.env.EXTENSION_APPROVAL_FINGERPRINT = String(fp);
        process.env.EXTENSION_AGENT_APPROVAL_REQUIRED = String(agent);
        const key = `fp=${fp},agent=${agent}`;
        const obs = await runScenario(`${fp ? 'f' : 'n'}${agent ? 'a' : 'n'}`);
        recorded[key] = obs;
        if (!UPDATE_FIXTURE) expect(obs).toEqual(golden[key]);
    });

    // golden 이 무엇을 고정하는지 사람이 읽을 수 있게 — 조합 사이의 차이만 따로 단언한다(fixture 가 바뀌면 함께 깨진다).
    it('golden 요약 — 플래그가 바꾸는 것은 업데이트 승인 이어받기와 에이전트 설치 상태뿐', () => {
        type Db = { skills: Array<{ name: string; status: string; linked: boolean }>; agents: Array<{ name: string; approval_status: string; is_active: boolean }> };
        const linkedSkill = (k: string, name: string) =>
            (golden[k].update as { db: Db }).db.skills.find(r => r.name === name && r.linked)?.status;
        const agentAfter = (k: string, step: 'install' | 'update') =>
            (golden[k][step] as { db: Db }).db.agents.find(a => a.is_active)?.approval_status;
        const table = Object.fromEntries(Object.keys(golden).map(k => [k, {
            alpha: linkedSkill(k, 'alpha'), beta: linkedSkill(k, 'beta'), gamma: linkedSkill(k, 'gamma'),
            agentV1: agentAfter(k, 'install'), agentV2: agentAfter(k, 'update'),
        }]));
        expect(table).toEqual({
            'fp=false,agent=false': { alpha: 'active', beta: 'active', gamma: 'draft', agentV1: 'approved', agentV2: 'approved' },
            'fp=true,agent=false': { alpha: 'active', beta: 'draft', gamma: 'draft', agentV1: 'approved', agentV2: 'approved' },
            'fp=false,agent=true': { alpha: 'active', beta: 'active', gamma: 'draft', agentV1: 'pending', agentV2: 'approved' },
            'fp=true,agent=true': { alpha: 'active', beta: 'draft', gamma: 'draft', agentV1: 'pending', agentV2: 'pending' },
        });
    });
});
