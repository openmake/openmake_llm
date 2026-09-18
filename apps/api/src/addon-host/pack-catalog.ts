/**
 * 팩 MCP 카탈로그 — 매니페스트 `components.mcpCatalog` 가 가리키는 커넥터 템플릿과 그 설치 (2026-09-19).
 *
 * 새 커넥터는 SQL 마이그레이션 시드가 아니라 팩의 `mcp-catalog.json` 으로 들어온다. 설치는 **항목당 한 번**이다
 * (설치 이력 `addon_installed_items`) — 관리자가 카탈로그에서 지우거나 고친 템플릿을 부팅이 되돌리지 않는다.
 * 꺼진 add-on 의 템플릿은 지우지 않고 카탈로그 조회에서만 가린다(`disabledCatalogTemplateIds`, 다시 켜면 그대로 보인다).
 *
 * @module addon-host/pack-catalog
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { BUILTIN_ADDON_IDS, builtinAddonDir, isBuiltinAddonEnabled, type BuiltinAddonId } from './builtin-registry';
import { addonManifestSchema } from './manifest';

const catalogTemplateSchema = z.object({
    id: z.string().min(1).max(120),
    displayName: z.string().min(1).max(200),
    description: z.string().max(2000),
    transportType: z.enum(['stdio', 'streamable-http']),
    commandTemplate: z.string().min(1).max(1000).optional(),
    urlTemplate: z.string().min(1).max(1000).optional(),
    argsSchema: z.record(z.string(), z.unknown()),
    envSchema: z.record(z.string(), z.unknown()),
    toolAllowlist: z.array(z.string()).optional(),
    /** 처음 설치될 때의 is_enabled — 이후는 관리자가 정한다 */
    defaultEnabled: z.boolean(),
}).strict().refine(
    t => (t.transportType === 'stdio' ? !!t.commandTemplate : !!t.urlTemplate),
    'stdio 는 commandTemplate, streamable-http 는 urlTemplate 이 필요하다',
);

export type PackCatalogTemplate = z.infer<typeof catalogTemplateSchema>;

const cache = new Map<string, PackCatalogTemplate[]>();

/** add-on 의 카탈로그 템플릿 — 매니페스트에 `components.mcpCatalog` 가 없으면 빈 배열. 형식이 어긋나면 throw. */
export function loadPackCatalog(id: BuiltinAddonId): PackCatalogTemplate[] {
    const cached = cache.get(id);
    if (cached) return cached;
    const dir = builtinAddonDir(id);
    const manifest = addonManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'openmake-addon.json'), 'utf-8')));
    const rel = manifest.components.mcpCatalog;
    const templates = rel ? z.array(catalogTemplateSchema).parse(JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf-8'))) : [];
    cache.set(id, templates);
    return templates;
}

/** 꺼진 add-on 이 소유한 카탈로그 템플릿 id — 카탈로그 조회에서 제외한다. */
export function disabledCatalogTemplateIds(): string[] {
    return BUILTIN_ADDON_IDS.filter(id => !isBuiltinAddonEnabled(id)).flatMap(id => loadPackCatalog(id).map(t => t.id));
}

interface PackCatalogStore {
    installCatalogTemplateOnce(addonId: string, template: PackCatalogTemplate): Promise<boolean>;
}

export async function installPackCatalog(id: BuiltinAddonId, store: PackCatalogStore): Promise<{ installed: string[]; failed: string[] }> {
    const installed: string[] = [];
    const failed: string[] = [];
    for (const template of loadPackCatalog(id)) {
        try {
            if (await store.installCatalogTemplateOnce(id, template)) installed.push(template.id);
        } catch (err) {
            failed.push(`${template.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { installed, failed };
}
