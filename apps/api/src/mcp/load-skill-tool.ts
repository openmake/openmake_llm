/**
 * ============================================================
 * MCP Tool: load_skill — 스킬 자동 호출 (LLM self-select)
 * ============================================================
 *
 * 채팅 중 모델이 호출하는 도구. 시스템이 이 도구의 description 에 active 스킬
 * 카탈로그("## Skill Library")를 주입하면(ChatService.getAllowedTools), 모델이
 * 질문과 관련된 스킬 이름을 골라 호출한다. 핸들러는 이름 → 전체 content 를
 * 조회해 반환하고, 다음 턴에서 모델이 그 지침으로 답한다(progressive disclosure).
 *
 * 안전 원칙:
 * - 카탈로그 주입/노출은 SKILL_AUTO_SELECT_ENABLED 플래그로 게이팅(getAllowedTools).
 * - 미매칭/오류는 throw 하지 않고 안내 텍스트 반환(채팅 흐름 무중단).
 *
 * @module mcp/load-skill-tool
 */
import type { MCPToolDefinition, MCPToolResult } from './types';
import type { UserContext } from './user-sandbox';
import { createLogger } from '../utils/logger';

const logger = createLogger('LoadSkillTool');

export const LOAD_SKILL_TOOL_NAME = 'load_skill';

interface LoadSkillArgs extends Record<string, unknown> {
    skill_names: string[];
    /** 스킬에 딸린 번들 파일(scripts/·references/) 상대 경로 — 지정 시 그 내용을 함께 반환 */
    asset_paths?: string[];
}

/** 번들 파일 1개당 주입 상한 — 컨텍스트 폭증 방지 (초과분은 잘라내고 표시) */
const ASSET_TEXT_CAP = 8_000;

/**
 * 매칭된 스킬들의 번들 파일 중 요청 경로에 해당하는 것을 텍스트로 조립.
 * 실패·미존재는 안내 문구로 대체한다 (채팅 흐름 무중단).
 */
async function loadSkillAssets(
    matchedNames: string[], relPaths: string[], userId?: string,
): Promise<string> {
    try {
        const { getSkillManager } = await import('../agents/skill-manager');
        const { SkillAssetRepository } = await import('../data/repositories/skill-asset-repository');
        const { getPool } = await import('../data/models/unified-database');
        const repo = new SkillAssetRepository(getPool());

        const blocks: string[] = [];
        for (const name of matchedNames) {
            const found = await getSkillManager().searchSkills({ search: name, status: 'active', limit: 5, userId });
            const skill = found.skills.find(sk => sk.name === name);
            if (!skill) continue;
            const rows = await repo.listWithContent(skill.id);
            for (const rel of relPaths) {
                const hit = rows.find(r => r.rel_path === rel || r.rel_path.endsWith(`/${rel}`));
                if (!hit) continue;
                const text = hit.content.toString('utf8');
                const body = text.length > ASSET_TEXT_CAP
                    ? `${text.slice(0, ASSET_TEXT_CAP)}\n… (${text.length - ASSET_TEXT_CAP}자 생략)`
                    : text;
                blocks.push(`<skill_asset skill="${name}" path="${hit.rel_path}">\n${body}\n</skill_asset>`);
            }
        }
        if (blocks.length === 0) {
            return `\n\n(요청한 번들 파일을 찾지 못했습니다: ${relPaths.join(', ')})`;
        }
        return `\n\n${blocks.join('\n\n')}`;
    } catch (e) {
        logger.warn(`번들 파일 로드 실패 (본문만 반환): ${e instanceof Error ? e.message : String(e)}`);
        return '';
    }
}

export const loadSkillTool: MCPToolDefinition<LoadSkillArgs> = {
    tool: {
        name: LOAD_SKILL_TOOL_NAME,
        description:
            '스킬 라이브러리에서 현재 질문에 직접 관련된 전문 스킬을 불러온다. ' +
            '사용 가능한 스킬은 이 설명 하단의 "## Skill Library" 카탈로그에 있다. ' +
            '질문과 직접 관련된 스킬이 있을 때만 그 정확한 이름을 skill_names 에 넣어 호출하라. ' +
            '가장 관련된 1~3개만 고르고, 관련 스킬이 없으면 이 도구를 호출하지 마라. ' +
            '스킬 본문이 `references/...` · `scripts/...` 같은 딸린 파일을 가리키고 그 내용이 필요하면 ' +
            'asset_paths 에 그 상대 경로를 넣어 함께 요청하라.',
        inputSchema: {
            type: 'object',
            properties: {
                skill_names: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '불러올 스킬 이름들 — Skill Library 카탈로그의 정확한 이름. 가장 관련된 1~3개만.',
                },
                asset_paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '함께 열 번들 파일의 상대 경로 (예: "references/rules.md"). 스킬 본문에 목록이 안내된 경우에만 사용.',
                },
            },
            required: ['skill_names'],
        },
    },
    handler: async (args, context?: UserContext): Promise<MCPToolResult> => {
        const names = Array.isArray(args.skill_names)
            ? args.skill_names.filter((n): n is string => typeof n === 'string')
            : [];
        if (names.length === 0) {
            return { content: [{ type: 'text', text: '불러올 스킬 이름이 없습니다.' }] };
        }
        const userId = context?.userId !== undefined ? String(context.userId) : undefined;
        try {
            const { getSkillManager } = await import('../agents/skill-manager');
            const { prompt, matched } = await getSkillManager().buildSkillPromptForNames(names, userId);
            if (!prompt || matched.length === 0) {
                return { content: [{ type: 'text', text: `요청한 스킬을 찾지 못했습니다: ${names.join(', ')}` }] };
            }
            // 번들 파일 열람 (Phase 2) — 본문이 참조하는 scripts/·references/ 를 on-demand 로 제공.
            // 본문에 목록이 안내돼 있어야 모델이 경로를 알 수 있고, 여기서 실제 내용을 채운다.
            const assetPaths = Array.isArray(args.asset_paths)
                ? args.asset_paths.filter((p): p is string => typeof p === 'string')
                : [];
            let assetText = '';
            if (assetPaths.length > 0) {
                assetText = await loadSkillAssets(matched, assetPaths, userId);
            }
            logger.info(`load_skill: ${matched.join(', ')}${assetPaths.length > 0 ? ` +assets(${assetPaths.length})` : ''} (user=${userId ?? 'guest'})`);
            return { content: [{ type: 'text', text: prompt + assetText }] };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`load_skill 실패: ${msg}`);
            return { content: [{ type: 'text', text: `스킬 로드 실패: ${msg}` }], isError: true };
        }
    },
};
