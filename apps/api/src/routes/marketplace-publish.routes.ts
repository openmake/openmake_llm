/**
 * 마켓플레이스 게시 (내부) — mount: `/api/marketplace`
 *
 *   GET  /publish/candidates   내가 만든 스킬·Custom Agent·MCP (확장 유래 제외)
 *   POST /publish              번들 → DB(marketplace_bundles) → 내 확장 행(user_extensions, 갤러리 공유)
 *
 * 사용자 결정(2026-08-25): 게시는 **이 배포 안에서만** — GitHub 로 나가지 않는다. 번들은 Claude Code
 * 플러그인 규격 그대로 만들어 DB 에 저장하고, 소유자의 user_extensions 행이 `internal://bundle/<id>` 를
 * 가리키며 갤러리(visibility=shared)에 노출된다. 다른 사용자의 설치는 기존 확장 ingest 가
 * InternalBundleFetcher 로 번들을 읽어 수행한다(draft → /approvals 승인 동일).
 *
 * 게시자 본인에게는 구성요소를 다시 설치하지 않는다(자기 스킬의 중복 draft 방지) — 확장 행만 만든다.
 * MCP 자격증명 값은 절대 나가지 않는다(키만 `${KEY}` 자리표시자).
 *
 * @module routes/marketplace-publish.routes
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { MarketplaceExportRepository } from '../data/repositories/marketplace-export-repository';
import { MarketplaceBundleRepository } from '../data/repositories/marketplace-bundle-repository';
import { UserExtensionRepository } from '../data/repositories/user-extension-repository';
import { buildPluginBundle, validatePluginName } from '../services/marketplace/plugin-bundle-builder';
import { INTERNAL_BUNDLE_PREFIX } from '../agents/git-ingest/internal-bundle-fetcher';
import { MARKETPLACE_PUBLISH_LIMITS } from '../config/marketplace-publish';
import { getAuditService } from '../services/AuditService';

export const marketplacePublishRouter = Router();

const publishSchema = z.object({
    pluginName: z.string().min(1).max(MARKETPLACE_PUBLISH_LIMITS.pluginNameMax),
    description: z.string().max(500).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    category: z.string().max(60).optional(),
    skillIds: z.array(z.string().max(80)).max(MARKETPLACE_PUBLISH_LIMITS.maxSkills).default([]),
    agentIds: z.array(z.string().max(80)).max(MARKETPLACE_PUBLISH_LIMITS.maxAgents).default([]),
    mcpServerIds: z.array(z.string().max(80)).max(MARKETPLACE_PUBLISH_LIMITS.maxMcpServers).default([]),
    /** 갤러리 공유 여부 — 기본 공유. private 면 내 확장 목록에만 남는다(나중에 공유 전환 가능) */
    visibility: z.enum(['shared', 'private']).default('shared'),
});

marketplacePublishRouter.get('/publish/candidates', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const repo = new MarketplaceExportRepository(getPool());
    res.json(success(await repo.getCandidatesSafe(userId)));
}));

marketplacePublishRouter.post('/publish', requireAuth, validate(publishSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const body = req.body as z.infer<typeof publishSchema>;
    const nameErr = validatePluginName(body.pluginName);
    if (nameErr) { res.status(400).json(badRequest(nameErr)); return; }

    const pool = getPool();
    const exportRepo = new MarketplaceExportRepository(pool);
    const [skills, agents, mcpServers] = await Promise.all([
        exportRepo.getSkills(userId, body.skillIds), exportRepo.getAgents(userId, body.agentIds), exportRepo.getMcpServers(userId, body.mcpServerIds),
    ]);
    // 요청한 id 가 소유·활성 조건을 못 넘으면 조용히 빠진다 — 그 사실을 응답에 드러낸다
    const missing = {
        skills: body.skillIds.filter((id) => !skills.some((s) => s.id === id)),
        agents: body.agentIds.filter((id) => !agents.some((a) => a.id === id)),
        mcpServers: body.mcpServerIds.filter((id) => !mcpServers.some((m) => m.id === id)),
    };
    const assets = await exportRepo.getSkillAssets(skills.map((s) => s.id));
    const bundle = buildPluginBundle({ pluginName: body.pluginName, description: body.description, version: body.version, category: body.category, skills, assets, agents, mcpServers });

    // 번들 파일 경로는 레포 규격(plugins/<name>/…)이지만, 설치 ingest 는 플러그인 루트를 기대하므로
    // 저장 시 접두를 벗겨 루트(.claude-plugin/plugin.json, skills/…)로 둔다.
    const prefix = `${bundle.pluginDir}/`;
    const files = bundle.files.map((f) => ({ path: f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path, content: f.content }));
    const bundleRepo = new MarketplaceBundleRepository(pool);
    const stored = await bundleRepo.upsert({ ownerId: userId, name: body.pluginName, version: body.version ?? '1.0.0', description: body.description, category: body.category, files });

    // 소유자의 확장 행 — 갤러리 노출 단위. 구성요소는 다시 설치하지 않는다(내 스킬의 중복 draft 방지).
    const extRepo = new UserExtensionRepository(pool);
    const sourceUrl = `${INTERNAL_BUNDLE_PREFIX}${stored.id}`;
    const manifest = { name: body.pluginName, version: stored.version, description: body.description ?? '', origin: 'internal-publish' };
    const existing = await extRepo.findActiveByName(userId, body.pluginName);
    let ext;
    if (existing && existing.source_url === sourceUrl) {
        ext = await extRepo.updateAfterReinstall(existing.id, { version: stored.version, description: body.description ?? null, sourceRef: stored.sha, sourcePath: '.claude-plugin/plugin.json', sourceHash: stored.sha, trackingRef: null, manifest });
    } else if (existing) {
        res.status(409).json(badRequest(`같은 이름의 확장이 이미 다른 소스(${existing.source_url})로 설치돼 있습니다 — 이름을 바꾸거나 기존 확장을 제거하세요`));
        return;
    } else {
        ext = await extRepo.insert({ userId, name: body.pluginName, version: stored.version, description: body.description ?? null, sourceUrl, sourceRef: stored.sha, sourcePath: '.claude-plugin/plugin.json', sourceHash: stored.sha, trackingRef: null, manifest });
    }
    if (ext && ext.visibility !== body.visibility) ext = await extRepo.setVisibility(ext.id, userId, body.visibility);

    getAuditService().logAudit({ userId, action: 'marketplace.publish', resourceType: 'marketplace_bundle', resourceId: stored.id, details: { plugin: body.pluginName, extensionId: ext?.id, visibility: body.visibility, files: files.length, missing } }).catch(() => { /* noop */ });
    res.json(success({ bundleId: stored.id, extensionId: ext?.id ?? null, visibility: ext?.visibility ?? body.visibility, plugin: body.pluginName, sha: stored.sha, bytes: bundle.totalBytes, files: files.map((f) => f.path), missing }));
}));
