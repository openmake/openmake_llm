/**
 * 운영 구성 내보내기/가져오기 (F22 Phase E-1, 2026-09-17).
 *
 *   GET  /api/admin/config/export                — { version, exportedAt, systemSettings, capabilityModels, organizations }
 *   POST /api/admin/config/import { config, apply? } — 기본 dry-run(검증·변경 요약만), apply=true 면 적용 + 이력·감사
 *
 * 대상은 운영 설정뿐이다: 시스템 설정(시크릿 제외 — describe() 가 값을 싣지 않는다), 전역 capability 배정,
 * 조직(slug 기준 upsert, 멤버 제외) + 조직 정책. 사용자·키·대화·작업은 대상이 아니다.
 * 적용은 부분 성공을 남기지 않게 검증을 먼저 전부 끝낸 뒤 순서대로 쓰고, 실패 시 예외로 중단한다(설정 서비스가
 * 키 단위로 upsert 하므로 DB 트랜잭션 대신 "검증 완료 후 적용" 으로 부분 적용 위험을 줄인다).
 *
 * @module routes/admin-config-export
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { getSystemSettingsService } from '../services/system-settings-service';
import { SETTING_DEFS_BY_KEY } from '../config/system-settings-registry';
import { CapabilityModelsRepository } from '../data/repositories/capability-models-repo';
import { CAPABILITIES, GLOBAL_CAPABILITY_SCOPE, type Capability } from '../config/capabilities';
import { OrganizationRepository } from '../data/repositories/organization-repository';
import { OrganizationPolicyRepository } from '../data/repositories/organization-policy-repository';
import { isOrgPolicyKey, ORG_POLICY_SCHEMAS } from '../config/org-policy-registry';
import { clearOrgPolicyCache } from '../services/org/effective-policy';
import { clearOrgMembershipCache } from '../services/org/membership-cache';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';

const logger = createLogger('AdminConfigExport');
export const CONFIG_EXPORT_VERSION = 1;

const configSchema = z.object({
    version: z.literal(CONFIG_EXPORT_VERSION),
    systemSettings: z.record(z.string(), z.string()).default({}),
    capabilityModels: z.array(z.object({ capability: z.string(), fullId: z.string().min(1), params: z.record(z.string(), z.string()).default({}) })).default([]),
    organizations: z.array(z.object({
        slug: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
        name: z.string().trim().min(1).max(200),
        monthlyTokenBudget: z.number().int().min(1).nullable().default(null),
        policies: z.record(z.string(), z.unknown()).default({}),
    })).default([]),
});
const importSchema = z.object({ config: configSchema, apply: z.boolean().default(false) });

export type ExportedConfig = z.infer<typeof configSchema>;

/** PURE: 가져올 구성의 키·값 검증 — 문제 목록(비면 통과). */
export function validateImportedConfig(cfg: ExportedConfig): string[] {
    const problems: string[] = [];
    for (const [key, value] of Object.entries(cfg.systemSettings)) {
        const def = SETTING_DEFS_BY_KEY.get(key);
        if (!def) { problems.push(`systemSettings: 허용되지 않은 키 ${key}`); continue; }
        if (def.secret) { problems.push(`systemSettings: 시크릿 키는 가져오기 대상이 아닙니다 ${key}`); continue; }
        const r = def.validate.safeParse(value);
        if (!r.success) problems.push(`systemSettings: ${key} 값 형식 오류`);
    }
    for (const c of cfg.capabilityModels) {
        if (!(CAPABILITIES as readonly string[]).includes(c.capability)) problems.push(`capabilityModels: 모르는 capability ${c.capability}`);
    }
    const slugs = new Set<string>();
    for (const o of cfg.organizations) {
        if (slugs.has(o.slug)) problems.push(`organizations: slug 중복 ${o.slug}`);
        slugs.add(o.slug);
        for (const [k, v] of Object.entries(o.policies)) {
            if (!isOrgPolicyKey(k)) { problems.push(`organizations[${o.slug}].policies: 허용되지 않은 키 ${k}`); continue; }
            if (!ORG_POLICY_SCHEMAS[k].safeParse(v).success) problems.push(`organizations[${o.slug}].policies: ${k} 값 형식 오류`);
        }
    }
    return problems;
}

export const adminConfigExportRouter = Router();
adminConfigExportRouter.use('/config', requireAuth, requireAdmin);

adminConfigExportRouter.get('/config/export', asyncHandler(async (req: Request, res: Response) => {
    const pool = getPool();
    const systemSettings: Record<string, string> = {};
    for (const s of getSystemSettingsService().describe()) {
        if (!s.secret && s.source === 'db' && typeof s.value === 'string') systemSettings[s.key] = s.value;
    }
    const capabilityModels = (await new CapabilityModelsRepository(pool).listGlobal())
        .map((r) => ({ capability: r.capability, fullId: r.fullId, params: r.params }));
    const orgRepo = new OrganizationRepository(pool);
    const policyRepo = new OrganizationPolicyRepository(pool);
    const organizations = [];
    for (const o of await orgRepo.list()) {
        const policies: Record<string, unknown> = {};
        for (const p of await policyRepo.list(o.id)) policies[p.key] = p.value;
        organizations.push({
            slug: o.slug, name: o.name,
            monthlyTokenBudget: o.monthly_token_budget === null ? null : Number(o.monthly_token_budget),
            policies,
        });
    }
    const config: ExportedConfig = { version: CONFIG_EXPORT_VERSION, systemSettings, capabilityModels: capabilityModels as ExportedConfig['capabilityModels'], organizations };
    await getAuditService().logAudit({ action: 'config.exported', userId: String(req.user!.id), resourceType: 'config', details: { settings: Object.keys(systemSettings).length, organizations: organizations.length } });
    res.setHeader('Content-Disposition', `attachment; filename="openmake-config-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ ...config, exportedAt: new Date().toISOString() });
}));

adminConfigExportRouter.post('/config/import', asyncHandler(async (req: Request, res: Response) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(badRequest(`구성 형식 오류: ${parsed.error.issues[0]?.path.join('.') ?? ''}`));
    const { config, apply } = parsed.data;
    const problems = validateImportedConfig(config);
    const summary = {
        systemSettings: Object.keys(config.systemSettings).length,
        capabilityModels: config.capabilityModels.length,
        organizations: config.organizations.length,
        policies: config.organizations.reduce((n, o) => n + Object.keys(o.policies).length, 0),
    };
    if (problems.length > 0 || !apply) {
        return res.json(success({ applied: false, problems, summary }));
    }
    const pool = getPool();
    const actor = String(req.user!.id);
    if (summary.systemSettings > 0) await getSystemSettingsService().update(config.systemSettings, actor);
    const capRepo = new CapabilityModelsRepository(pool);
    for (const c of config.capabilityModels) await capRepo.upsert(GLOBAL_CAPABILITY_SCOPE, c.capability as Capability, c.fullId, c.params);
    const orgRepo = new OrganizationRepository(pool);
    const policyRepo = new OrganizationPolicyRepository(pool);
    const existing = new Map((await orgRepo.list()).map((o) => [o.slug, o]));
    for (const o of config.organizations) {
        let row = existing.get(o.slug);
        if (row) await orgRepo.update(row.id, { name: o.name, monthlyTokenBudget: o.monthlyTokenBudget });
        else row = await orgRepo.create(randomUUID(), o.name, o.slug, actor, o.monthlyTokenBudget);
        for (const [k, v] of Object.entries(o.policies)) await policyRepo.upsert(row.id, k, v, actor);
        clearOrgPolicyCache(row.id);
    }
    clearOrgMembershipCache();
    logger.info(`구성 가져오기 적용: ${JSON.stringify(summary)} by ${actor}`);
    await getAuditService().logAudit({ action: 'config.imported', userId: actor, resourceType: 'config', details: summary });
    res.json(success({ applied: true, problems: [], summary }));
}));
