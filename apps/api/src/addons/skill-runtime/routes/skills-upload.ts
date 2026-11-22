/**
 * 스킬 매니페스트 업로드 핸들러 — `POST /api/agents/skills/upload` (multipart/form-data, 필드 `file`).
 *
 * `skills.routes.ts` 가 600줄 가드에 닿아 라우트 본문만 여기로 분리했다(등록·multer 는 그쪽).
 *
 *   - YAML frontmatter + Markdown body
 *   - Zod 검증 + 도구 존재 검증 + sha256 checksum
 *   - 트랜잭션으로 skill_manifests + skill_tool_bindings + skill_mcp_bundles 저장
 *     (mcp_bundles 는 기록만 — 실행하지 않는다. 응답 compat_notes 에 안내, mcp-bundles-notice.ts)
 *   - 중복 (id, version) 시 checksum 비교: 동일하면 멱등, 다르면 에러
 *
 * @module routes/skills-upload
 */
import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import { createLogger } from '../../../utils/logger';
import { success, unauthorized } from '../../../utils/api-response';
import { parseSkillFile, validateManifest } from '../../../agents/manifest-validator';
import { adaptSkillContent } from '../../../agents/git-ingest/skill-compat';
import { ManifestImporter } from '../manifest-importer';
import { mcpBundlesNotice } from '../mcp-bundles-notice';
import { getUnifiedDatabase } from '../../../data/models/unified-database';
import { getToolRuntime } from '../../../runtime-ports/tool-runtime';
import { isAdminRole } from '../../../data/user-manager';

const logger = createLogger('SkillsUpload');

export async function uploadSkill(req: Request, res: Response): Promise<void> {
    const file = req.file;
    if (!file) {
        res.status(400).json({ error: 'file 필드가 필요합니다 (multipart/form-data)' });
        return;
    }

    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }
    const isAdmin = isAdminRole(req.user?.role);

    const content = file.buffer.toString('utf-8');
    let parsed;
    try {
        parsed = parseSkillFile(content);
    } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
        return;
    }

    const availableTools = (await getToolRuntime().listLLMTools({ userId })).map((t: { function: { name: string } }) => t.function.name);
    const availableToolNames = new Set<string>(availableTools);

    const validation = await validateManifest(parsed, { availableToolNames });
    if (!validation.ok) {
        res.status(400).json({ error: 'manifest 검증 실패', details: validation.errors });
        return;
    }

    // 설치 시 적응 — git ingest 와 동일 규칙 (외부 SKILL.md 를 업로드하는 경로도 대칭 적용).
    // 적응할 것이 없으면 원문 그대로라 이 프로젝트에서 만든 스킬은 무영향.
    const adapted = adaptSkillContent({
        frontmatter: validation.raw_frontmatter,
        promptMd: validation.prompt_md,
    });
    const uploadChecksum = adapted.adapted
        ? createHash('sha256').update(adapted.content).digest('hex')
        : validation.checksum;

    try {
        const importer = new ManifestImporter(getUnifiedDatabase().getPool());
        const result = await importer.import({
            manifest: validation.manifest,
            prompt_md: adapted.content,
            raw_yaml: validation.raw_yaml,
            checksum: uploadChecksum,
            createdBy: userId,
            isAdmin,
        });
        const bundlesNote = mcpBundlesNotice(validation.manifest.mcp_bundles);
        logger.info(`skill upload: ${result.skill_id} v${result.version} (inserted=${result.inserted}, dup=${result.duplicate_checksum}, user=${userId})`);
        res.status(result.inserted ? 201 : 200).json(success({
            skill_id: result.skill_id,
            version: result.version,
            inserted: result.inserted,
            duplicate_checksum: result.duplicate_checksum,
            bindings_count: validation.manifest.tool_bindings.length,
            bundles_count: validation.manifest.mcp_bundles.length,
            compat_notes: [...adapted.notes, ...(bundlesNote ? [bundlesNote] : [])],
        }));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ error: msg });
    }
}
