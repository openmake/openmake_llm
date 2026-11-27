/**
 * 레지스트리 항목 → MCP 카탈로그 초안 입력. 순수 함수 — 실행·연결하지 않는다.
 *
 * 옮길 수 있는 설치 방식만 옮긴다(이 환경 카탈로그 규약: 원격은 고정 URL, stdio 는 버전 고정 명령):
 *  ① 원격 streamable-http(없으면 sse) — URL 에 템플릿 변수(`{...}`)가 있으면 제외(사용자별 값이 필요하다)
 *  ② npm 패키지 + 고정 버전 → `npx -y <패키지>@<버전>` ③ PyPI 패키지 + 고정 버전 → `uvx <패키지>==<버전>`
 * 그 밖(OCI·NuGet·MCPB·버전 없음)은 옮기지 않고 사유를 돌려준다 — 관리자가 MCP 카탈로그 화면에서 직접 만든다.
 * env 는 이름·설명·필수·비밀 여부만 env_schema 로 옮긴다(비밀은 `secret:true` — CLI 인자로 넣지 않는다).
 *
 * @module addons/extension-marketplace/registry/promote
 */
import type { McpCatalogDraftInput } from '../../../runtime-ports/mcp-catalog-templates';
import type { StoredRegistryEntry } from './registry-repository';
import type { RegistryEnvVar } from './server-json';

export type PromoteReason = 'TOMBSTONED' | 'NOT_APPROVED' | 'NO_SUPPORTED_INSTALL';

export type PromotePlan = { ok: true; input: McpCatalogDraftInput } | { ok: false; reason: PromoteReason };

const ID_PREFIX = 'mcp-reg-';
const ID_MAX = 100;
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const PYPI_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PINNED_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;
const REMOTE_PREFERENCE: readonly string[] = ['streamable-http', 'sse'];

/** 서버 이름 → 카탈로그 id(`mcp-reg-<slug>`) — 소문자·숫자·하이픈만, 길이 상한 */
export function catalogIdFor(serverName: string): string {
    const slug = serverName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (ID_PREFIX + slug).slice(0, ID_MAX).replace(/-+$/, '');
}

function envSchema(env: readonly RegistryEnvVar[]): Record<string, unknown> {
    if (env.length === 0) return {};
    return {
        type: 'object',
        required: env.filter(e => e.required).map(e => e.name),
        properties: Object.fromEntries(env.map(e => [e.name, {
            type: 'string',
            title: e.name,
            ...(e.description ? { description: e.description } : {}),
            ...(e.secret ? { secret: true } : {}),
        }])),
    };
}

function description(entry: StoredRegistryEntry): string {
    const head = `MCP Registry: ${entry.serverName}@${entry.version}`;
    return (entry.description ? `${entry.description}\n\n${head}` : head).slice(0, 1000);
}

export function planCatalogDraft(entry: StoredRegistryEntry): PromotePlan {
    if (entry.tombstonedAt) return { ok: false, reason: 'TOMBSTONED' };
    if (entry.curation !== 'approved') return { ok: false, reason: 'NOT_APPROVED' };
    const base = {
        id: catalogIdFor(entry.serverName),
        displayName: (entry.title ?? entry.serverName).slice(0, 200),
        description: description(entry),
    };
    for (const type of REMOTE_PREFERENCE) {
        const remote = entry.remotes.find(r => r.type === type && !/[{}]/.test(r.url) && r.url.startsWith('https://'));
        if (remote) {
            return { ok: true, input: { ...base, transportType: type as McpCatalogDraftInput['transportType'], urlTemplate: remote.url } };
        }
    }
    for (const pkg of entry.packages) {
        if (pkg.transport !== 'stdio' || !pkg.version || pkg.version === 'latest' || !PINNED_VERSION.test(pkg.version)) continue;
        if (pkg.registryType === 'npm' && NPM_NAME.test(pkg.identifier)) {
            return { ok: true, input: { ...base, transportType: 'stdio', commandTemplate: `npx -y ${pkg.identifier}@${pkg.version}`, envSchema: envSchema(pkg.env) } };
        }
        if (pkg.registryType === 'pypi' && PYPI_NAME.test(pkg.identifier)) {
            return { ok: true, input: { ...base, transportType: 'stdio', commandTemplate: `uvx ${pkg.identifier}==${pkg.version}`, envSchema: envSchema(pkg.env) } };
        }
    }
    return { ok: false, reason: 'NO_SUPPORTED_INSTALL' };
}
