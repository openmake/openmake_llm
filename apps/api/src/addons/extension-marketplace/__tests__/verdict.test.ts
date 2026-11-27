/**
 * 갤러리 호환 판정 규칙(M1, 2026-11-27) — 순수 함수. 사유 코드 → 무게 → 판정, 출처, 설치본 매칭.
 */
import type { InstalledExtensionEvidence, InstalledSkillEvidence } from '../../../runtime-ports/extension-catalog';
import type { McpServerInsight } from '../../../runtime-ports/component-insights';
import { computeVerdict, insightServerIds, matchEvidence, ownerFromUrl } from '../verdict';
import { REASON_SEVERITY } from '../constants';

const CAT = 'https://github.com/acme/marketplace';
const codes = (v: ReturnType<typeof computeVerdict>) => v.reasons.map(r => r.code);

function skill(over: Partial<InstalledSkillEvidence> = {}): InstalledSkillEvidence {
    return {
        name: 's', fromCommand: false, assetCount: 0, markers: [], unsupportedTools: [], requiredMissing: [],
        unsupportedFeatures: [], blocked: false, content: 'Plain instructions.', ...over,
    };
}
function evidence(over: Partial<InstalledExtensionEvidence> = {}): InstalledExtensionEvidence {
    return {
        name: 'p', version: '1.0.0', sourceUrl: CAT, sourcePath: '', commit: 'abcdef1234567890', installedAt: '2026-11-27T00:00:00Z',
        author: 'Acme Inc', license: 'MIT', homepage: null, warningCodes: [], skills: [skill()], mcpServers: [], agentCount: 0, ...over,
    };
}
const none = new Map<string, McpServerInsight>();

describe('computeVerdict — 스냅샷만', () => {
    it('installable=false 는 불가, 출처는 URL 소유자', () => {
        const v = computeVerdict({ catalogUrl: CAT, plugin: { name: 'p', installable: false }, evidence: null, insights: none });
        expect(v.verdict).toBe('unsupported');
        expect(codes(v)).toEqual(['CONTENT_NOT_EVALUATED', 'NOT_INSTALLABLE']);
        expect(v.provenance).toEqual({ publisher: 'acme', commit: null, license: null, sourceUrl: CAT });
        expect(v.evaluated).toBe('snapshot');
    });

    it('installable=true 이고 설치본이 없으면 지원(내용 미평가 참고 사유만)', () => {
        const v = computeVerdict({ catalogUrl: CAT, plugin: { name: 'p', installable: true }, evidence: null, insights: none });
        expect(v.verdict).toBe('supported');
        expect(v.reasons).toEqual([{ code: 'CONTENT_NOT_EVALUATED', severity: 'info', count: 0 }]);
    });

    it('설치 가능성 미상(교차 저장소)은 부분 지원 + 원본은 항목 source', () => {
        const v = computeVerdict({ catalogUrl: CAT, plugin: { name: 'p', source: 'https://github.com/other/repo' }, evidence: null, insights: none });
        expect(v.verdict).toBe('partial');
        expect(codes(v)).toEqual(['CONTENT_NOT_EVALUATED', 'CROSS_REPO_SOURCE', 'INSTALLABILITY_UNKNOWN']);
        expect(v.provenance.publisher).toBe('other');
        expect(v.provenance.sourceUrl).toBe('https://github.com/other/repo');
    });
});

describe('computeVerdict — 설치본 근거', () => {
    it('관용구가 없으면 지원, 출처는 plugin.json·설치 커밋', () => {
        const v = computeVerdict({ catalogUrl: CAT, plugin: { name: 'p', installable: true }, evidence: evidence(), insights: none });
        expect(v.verdict).toBe('supported');
        expect(v.reasons).toEqual([]);
        expect(v.provenance).toEqual({ publisher: 'Acme Inc', commit: 'abcdef1234567890', license: 'MIT', sourceUrl: CAT });
        expect(v.evaluated).toBe('installed');
    });

    it('스킬 관용구(①mcp__ ②폴더 밖 참조 ③commands 자산 ④.claude/ ⑤설치 안내)를 스킬 수와 함께 센다', () => {
        const ev = evidence({
            skills: [
                skill({ content: 'Call mcp__apollo__search then read [x](../../CONNECTORS.md).', fromCommand: true }),
                skill({ content: 'See ../shared/notes.md', markers: ['.claude/', 'install-guide'] }),
                skill({ content: 'Edit .claude/settings.json' }),
            ],
        });
        const v = computeVerdict({ catalogUrl: CAT, plugin: { name: 'p' }, evidence: ev, insights: none });
        expect(v.verdict).toBe('partial');
        const byCode = Object.fromEntries(v.reasons.map(r => [r.code, r.count]));
        expect(byCode).toEqual({
            SKILL_MCP_TOOL_IDIOM: 1,
            SKILL_ASSET_OUTSIDE_DIR: 2,
            SKILL_COMMAND_ASSETS_SKIPPED: 1,
            SKILL_CLAUDE_DIR_PATH: 2,
            SKILL_CLAUDE_INSTALL_GUIDE: 1,
        });
        // 설치본이 있으면 설치 가능성 미상·내용 미평가는 붙지 않는다
        expect(codes(v)).not.toContain('INSTALLABILITY_UNKNOWN');
        expect(codes(v)).not.toContain('CONTENT_NOT_EVALUATED');
    });

    it('설치 안내만 있으면 참고 사유라 지원 그대로', () => {
        const v = computeVerdict({ catalogUrl: CAT, plugin: { name: 'p' }, evidence: evidence({ skills: [skill({ markers: ['install-guide'] })] }), insights: none });
        expect(v.verdict).toBe('supported');
        expect(codes(v)).toEqual(['SKILL_CLAUDE_INSTALL_GUIDE']);
    });

    it('도구 미대응·필수 도구 없음·실행 차단', () => {
        const ev = evidence({ skills: [skill({ unsupportedTools: ['NotebookEdit'], requiredMissing: ['Bash'], blocked: true })] });
        expect(codes(computeVerdict({ catalogUrl: CAT, plugin: { name: 'p' }, evidence: ev, insights: none })))
            .toEqual(['SKILL_EXECUTION_BLOCKED', 'SKILL_REQUIRED_TOOL_MISSING', 'SKILL_TOOL_UNSUPPORTED']);
    });

    it('설치 리포트 경고 코드를 사유로 옮긴다 — 모르는 경고는 무시', () => {
        const ev = evidence({ warningCodes: ['UNSUPPORTED_COMPONENTS', 'ASSET_TOO_LARGE', 'ASSET_BINARY_SKIPPED', 'SKILLS_TRUNCATED', 'SKILLS_ADAPTED'] });
        const v = computeVerdict({ catalogUrl: CAT, plugin: { name: 'p' }, evidence: ev, insights: none });
        expect(codes(v)).toEqual(['ASSETS_SKIPPED', 'COMPONENTS_TRUNCATED', 'COMPONENTS_UNSUPPORTED']);
        expect(v.verdict).toBe('partial');
    });

    it('MCP — SSE 경고·DCR 참고·선언 확장(Apps/Tasks 불가, Skills 참고)·협상 결과·규약 차단', () => {
        const ev = evidence({
            skills: [],
            mcpServers: [
                { name: 'a', serverId: 'srv-a', transportType: 'streamable-http', blockedByConvention: false, failed: false },
                { name: 'b', serverId: 'srv-b', transportType: 'stdio', blockedByConvention: true, failed: false },
                { name: 'c', serverId: null, transportType: 'sse', blockedByConvention: false, failed: false },
            ],
        });
        const insights = new Map<string, McpServerInsight>([
            ['srv-a', { serverId: 'srv-a', transport: 'streamable-http', authMethod: 'oauth-dynamic', protocolEra: 'modern', protocolVersion: '2026-07-28', declaredExtensionKinds: ['apps', 'tasks', 'skills'] }],
            ['srv-b', { serverId: 'srv-b', transport: 'stdio', authMethod: 'none', protocolEra: 'legacy', protocolVersion: '2025-06-18', declaredExtensionKinds: [] }],
        ]);
        const v = computeVerdict({ catalogUrl: CAT, plugin: { name: 'p' }, evidence: ev, insights });
        expect(v.verdict).toBe('partial');
        expect(Object.fromEntries(v.reasons.map(r => [r.code, r.severity]))).toEqual({
            MCP_AUTH_DYNAMIC_REGISTRATION: 'info',
            MCP_BLOCKED_BY_CONVENTION: 'degrading',
            MCP_EXT_APPS_UNSUPPORTED: 'degrading',
            MCP_EXT_TASKS_UNSUPPORTED: 'degrading',
            MCP_PROTOCOL_LEGACY: 'info',
            MCP_PROTOCOL_MODERN: 'info',
            MCP_SKILLS_PROVIDER: 'info',
            MCP_TRANSPORT_SSE_DEPRECATED: 'degrading',
        });
    });

    it('Skills over MCP 만 선언한 서버는 지원 그대로(참고)', () => {
        const ev = evidence({ skills: [], mcpServers: [{ name: 'a', serverId: 's', transportType: 'stdio', blockedByConvention: false, failed: false }] });
        const insights = new Map<string, McpServerInsight>([['s', { serverId: 's', transport: 'stdio', authMethod: 'none', protocolEra: null, protocolVersion: null, declaredExtensionKinds: ['skills'] }]]);
        expect(computeVerdict({ catalogUrl: CAT, plugin: { name: 'p' }, evidence: ev, insights }).verdict).toBe('supported');
    });
});

describe('도움 함수', () => {
    it('ownerFromUrl', () => {
        expect(ownerFromUrl('https://github.com/anthropics/skills')).toBe('anthropics');
        expect(ownerFromUrl('git@github.com:acme/x.git')).toBe('acme');
        expect(ownerFromUrl('not a url')).toBeNull();
    });

    it('matchEvidence 는 같은 원본 + 같은 이름만', () => {
        const ev = [evidence({ name: 'p' }), evidence({ name: 'q', sourceUrl: 'https://github.com/other/repo' })];
        expect(matchEvidence(CAT, { name: 'p' }, ev)?.name).toBe('p');
        expect(matchEvidence(CAT, { name: 'q' }, ev)).toBeNull();
        expect(matchEvidence(CAT, { name: 'q', source: 'https://github.com/other/repo' }, ev)?.name).toBe('q');
    });

    it('insightServerIds 는 중복·null 제거', () => {
        const mk = (id: string | null) => ({ name: 'x', serverId: id, transportType: null, blockedByConvention: false, failed: false });
        expect(insightServerIds([evidence({ mcpServers: [mk('a'), mk(null)] }), evidence({ mcpServers: [mk('a'), mk('b')] })])).toEqual(['a', 'b']);
    });

    it('모든 사유 코드는 무게를 가진다(blocking·degrading·info)', () => {
        for (const sev of Object.values(REASON_SEVERITY)) expect(['blocking', 'degrading', 'info']).toContain(sev);
    });
});
