/**
 * MCP 카탈로그 초안 작성기 — `runtime-ports/mcp-catalog-templates` 에 꽂는 구현(다른 add-on 의 "카탈로그로 올리기").
 *
 * 관리자 카탈로그 생성과 같은 입력 검증(`createCatalogTemplateSchema`)을 거치고, 언제나 꺼진 상태로 만든다 —
 * 관리자가 MCP 카탈로그 화면에서 검토하고 켠다. 같은 id 가 이미 있으면 덮어쓰지 않는다(exists).
 *
 * @module addons/mcp-runtime/catalog-draft-writer
 */
import { getPool } from '../../runtime-ports/db-access';
import type { McpCatalogDraftInput, McpCatalogDraftResult } from '../../runtime-ports/mcp-catalog-templates';
import { createCatalogTemplateSchema } from './schemas/mcp-catalog-admin.schema';
import { McpCatalogAdminRepository } from './data/mcp-catalog-admin-repository';

export async function writeMcpCatalogDraft(
    input: McpCatalogDraftInput,
    repo: Pick<McpCatalogAdminRepository, 'getCatalogTemplateForAdmin' | 'insertCatalogTemplate'> = new McpCatalogAdminRepository(getPool()),
): Promise<McpCatalogDraftResult> {
    const parsed = createCatalogTemplateSchema.safeParse({
        id: input.id,
        display_name: input.displayName,
        description: input.description ?? null,
        transport_type: input.transportType,
        command_template: input.commandTemplate ?? null,
        url_template: input.urlTemplate ?? null,
        env_schema: input.envSchema ?? {},
        args_schema: {},
        is_enabled: false,
    });
    if (!parsed.success) {
        return { status: 'invalid', message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
    }
    if (await repo.getCatalogTemplateForAdmin(parsed.data.id)) return { status: 'exists', id: parsed.data.id };
    try {
        const created = await repo.insertCatalogTemplate({ ...parsed.data, is_enabled: false });
        return { status: 'created', id: created.id };
    } catch (e) {
        // 확인과 삽입 사이에 같은 id 가 생긴 경우
        if (/duplicate key|unique/i.test(e instanceof Error ? e.message : String(e))) return { status: 'exists', id: parsed.data.id };
        throw e;
    }
}
