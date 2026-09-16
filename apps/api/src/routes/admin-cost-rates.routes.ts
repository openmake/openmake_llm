/**
 * 단가표 관리 REST (F25 PR-1, 134). 관리자 전용.
 *   GET    /api/admin/cost-rates                 — { rates, kinds }
 *   PUT    /api/admin/cost-rates                 — { kind, rateKey, unit, usdPerMillion? | usdMicrosPerUnit?, note? }
 *   DELETE /api/admin/cost-rates/:kind/:rateKey/:unit
 * 토큰류 unit 은 usdPerMillion(1M 토큰당 USD)로 받으면 micros/token 으로 그대로 저장(1 USD/1M = 1 micro/token).
 * @module routes/admin-cost-rates
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, notFound } from '../utils/api-response';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { CostRateRepository } from '../data/repositories/cost-rate-repository';
import { COST_KINDS, COST_KIND_LIST, isCostKind, type CostKind, type CostUnit } from '../config/cost-kinds';
import { clearCostRateCache } from '../services/cost/cost-ledger-service';
import { getAuditService } from '../services/AuditService';

const putSchema = z.object({
    kind: z.string().min(1),
    rateKey: z.string().trim().min(1).max(200),
    unit: z.string().min(1),
    usdPerMillion: z.number().min(0).optional(),
    usdMicrosPerUnit: z.number().min(0).optional(),
    note: z.string().max(500).nullable().optional(),
}).refine((v) => v.usdPerMillion !== undefined || v.usdMicrosPerUnit !== undefined, '단가가 필요합니다');

const repo = () => new CostRateRepository(getPool());

export const adminCostRatesRouter = Router();
adminCostRatesRouter.use('/cost-rates', requireAuth, requireAdmin);

adminCostRatesRouter.get('/cost-rates', asyncHandler(async (_req: Request, res: Response) => {
    res.json(success({ rates: await repo().listAll(), kinds: COST_KIND_LIST.map((k) => ({ kind: k, units: COST_KINDS[k].units })) }));
}));

adminCostRatesRouter.put('/cost-rates', validate(putSchema), asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as z.infer<typeof putSchema>;
    if (!isCostKind(b.kind)) return res.status(400).json(badRequest(`모르는 kind: ${b.kind}`));
    const units = COST_KINDS[b.kind as CostKind].units as readonly string[];
    if (!units.includes(b.unit)) return res.status(400).json(badRequest(`kind ${b.kind} 의 unit 은 ${units.join('|')}`));
    const micros = b.usdMicrosPerUnit ?? b.usdPerMillion!;   // 토큰 unit: USD/1M == micros/token
    const row = await repo().upsert(b.kind, b.rateKey, b.unit as CostUnit, micros, b.note ?? null, String(req.user!.id));
    clearCostRateCache();
    await getAuditService().logAudit({ action: 'cost_rate.changed', userId: String(req.user!.id), resourceType: 'cost_rate', resourceId: `${b.kind}/${b.rateKey}/${b.unit}`, details: { micros } });
    res.json(success({ rate: row }));
}));

adminCostRatesRouter.delete('/cost-rates/:kind/:rateKey/:unit', asyncHandler(async (req: Request, res: Response) => {
    const { kind, rateKey, unit } = req.params;
    if (!(await repo().remove(kind, rateKey, unit))) return res.status(404).json(notFound('단가가 없습니다.'));
    clearCostRateCache();
    await getAuditService().logAudit({ action: 'cost_rate.changed', userId: String(req.user!.id), resourceType: 'cost_rate', resourceId: `${kind}/${rateKey}/${unit}`, details: { removed: true } });
    res.json(success({ removed: true }));
}));
