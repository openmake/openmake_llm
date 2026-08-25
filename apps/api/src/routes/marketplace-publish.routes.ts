/**
 * 마켓플레이스 게시 (발행형 (b)) — mount: `/api/marketplace`
 *
 *   GET  /publish/candidates   내가 만든 스킬·Custom Agent·MCP (확장 유래 제외)
 *   POST /publish              (admin) 번들 → 새 브랜치 커밋 → PR. { prUrl, branch, files }
 *
 * 공개 레포에 쓰는 행위라 admin 한정. 구성요소는 요청자 소유만 묶인다(저장소 쿼리가 강제).
 * 토큰: body.accessToken > MARKETPLACE_PUBLISH_TOKEN. MCP 자격증명 값은 절대 나가지 않는다(키만).
 *
 * @module routes/marketplace-publish.routes
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { getConfig } from '../config/env';
import { MarketplaceExportRepository } from '../data/repositories/marketplace-export-repository';
import { buildPluginBundle, validatePluginName } from '../services/marketplace/plugin-bundle-builder';
import { GithubPublisher } from '../services/marketplace/github-publisher';
import { MARKETPLACE_PATHS, MARKETPLACE_PUBLISH_LIMITS, resolveMarketplaceRepo } from '../config/marketplace-publish';
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
    accessToken: z.string().max(200).optional(),
});

marketplacePublishRouter.get('/publish/candidates', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const repo = new MarketplaceExportRepository(getPool());
    res.json(success({ ...(await repo.getCandidatesSafe(userId)), repo: resolveMarketplaceRepo() }));
}));

marketplacePublishRouter.post('/publish', requireAuth, requireAdmin, validate(publishSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const body = req.body as z.infer<typeof publishSchema>;
    const nameErr = validatePluginName(body.pluginName);
    if (nameErr) { res.status(400).json(badRequest(nameErr)); return; }
    const token = body.accessToken || getConfig().marketplacePublishToken;
    if (!token) { res.status(400).json(badRequest('GitHub 토큰이 필요합니다 (accessToken 또는 MARKETPLACE_PUBLISH_TOKEN)')); return; }

    const repo = new MarketplaceExportRepository(getPool());
    const [skills, agents, mcpServers] = await Promise.all([
        repo.getSkills(userId, body.skillIds), repo.getAgents(userId, body.agentIds), repo.getMcpServers(userId, body.mcpServerIds),
    ]);
    // 요청한 id 가 소유·활성 조건을 못 넘으면 조용히 빠진다 — 그 사실을 응답에 드러낸다
    const missing = {
        skills: body.skillIds.filter((id) => !skills.some((s) => s.id === id)),
        agents: body.agentIds.filter((id) => !agents.some((a) => a.id === id)),
        mcpServers: body.mcpServerIds.filter((id) => !mcpServers.some((m) => m.id === id)),
    };
    const assets = await repo.getSkillAssets(skills.map((s) => s.id));
    const bundle = buildPluginBundle({ pluginName: body.pluginName, description: body.description, version: body.version, category: body.category, skills, assets, agents, mcpServers });

    const { owner, repo: repoName } = resolveMarketplaceRepo();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
    const summary = `skills ${skills.length} · agents ${agents.length} · mcp ${mcpServers.length}`;
    const result = await new GithubPublisher(token).publish({
        owner, repo: repoName, files: bundle.files, marketplaceEntry: bundle.marketplaceEntry, token,
        branchName: `${MARKETPLACE_PATHS.branchPrefix}${body.pluginName}-${stamp}`,
        commitMessage: `feat(plugins): publish ${body.pluginName} from openmake_llm (${summary})`,
        prTitle: `publish: ${body.pluginName} (${summary})`,
        prBody: `openmake_llm 에서 게시한 플러그인 번들입니다.\n\n- ${summary}\n- 경로: \`${bundle.pluginDir}\`\n- MCP env 는 자리표시자(\`\${KEY}\`)만 포함됩니다.\n\n리뷰 후 머지하면 카탈로그 재동기화 시 설치 가능해집니다.`,
    });

    getAuditService().logAudit({ userId, action: 'marketplace.publish', resourceType: 'marketplace', resourceId: `${owner}/${repoName}`, details: { plugin: body.pluginName, prUrl: result.prUrl, missing } }).catch(() => { /* noop */ });
    res.json(success({ ...result, plugin: body.pluginName, bytes: bundle.totalBytes, missing }));
}));
