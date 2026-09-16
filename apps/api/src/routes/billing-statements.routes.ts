/**
 * 명세서 REST (F25 PR-5, 137).
 *   사용자: GET /api/usage/statements?month=YYYY-MM · GET /api/usage/statements/:month.csv
 *   관리자: GET /api/admin/billing/statements?scope=system|org:<id>|user:<id>&month= · GET /api/admin/billing/by-agent?days=
 * @module routes/billing-statements
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { CostLedgerRepository } from '../data/repositories/cost-ledger-repository';
import { getStatement, currentMonth, statementToCsv, type StatementSubject } from '../services/cost/statement-service';
import { csvCell } from '../utils/csv';

const monthOf = (req: Request): string => (typeof req.query.month === 'string' && req.query.month) ? req.query.month : currentMonth();

export const usageStatementsRouter = Router();
usageStatementsRouter.use(requireAuth);

usageStatementsRouter.get('/statements', asyncHandler(async (req: Request, res: Response) => {
    const st = await getStatement('user', String(req.user!.id), monthOf(req));
    if (!st) return res.status(400).json(badRequest('month 는 YYYY-MM 형식'));
    res.json(success({ statement: st }));
}));

usageStatementsRouter.get('/statements/:month.csv', asyncHandler(async (req: Request, res: Response) => {
    const st = await getStatement('user', String(req.user!.id), req.params.month);
    if (!st) return res.status(400).json(badRequest('month 는 YYYY-MM 형식'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${req.params.month}.csv"`);
    res.send('﻿' + statementToCsv(st, csvCell));
}));

export const adminBillingRouter = Router();
adminBillingRouter.use('/billing', requireAuth, requireAdmin);

adminBillingRouter.get('/billing/statements', asyncHandler(async (req: Request, res: Response) => {
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'system';
    let subjectType: StatementSubject = 'system'; let subjectId = 'system';
    if (scope.startsWith('org:')) { subjectType = 'org'; subjectId = scope.slice(4); }
    else if (scope.startsWith('user:')) { subjectType = 'user'; subjectId = scope.slice(5); }
    if (!subjectId) return res.status(400).json(badRequest('scope 형식: system | org:<id> | user:<id>'));
    const st = await getStatement(subjectType, subjectId, monthOf(req));
    if (!st) return res.status(400).json(badRequest('month 는 YYYY-MM 형식'));
    res.json(success({ statement: st }));
}));

adminBillingRouter.get('/billing/by-agent', asyncHandler(async (req: Request, res: Response) => {
    const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);
    const to = new Date(); const from = new Date(to.getTime() - days * 86_400_000);
    const rows = await new CostLedgerRepository(getPool()).costByAgent(from, to);
    const total = rows.reduce((n, r) => n + Number(r.cost_usd_micros), 0) || 1;
    res.json(success({ days, costByAgent: rows.map((r) => ({ agentId: r.agent_id, costUsd: Number(r.cost_usd_micros) / 1_000_000, percentage: Math.round(Number(r.cost_usd_micros) / total * 100) })) }));
}));
