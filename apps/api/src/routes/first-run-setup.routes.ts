/**
 * @module routes/first-run-setup
 * @description 첫 실행 셋업 마법사 API — admin 0명일 때만 동작하는 일회성 공개 엔드포인트.
 *
 *   GET  /api/setup/status — { setupNeeded } (+needed 일 때만 defaults.llmBaseUrl)
 *   POST /api/setup        — 관리자 생성 + LLM 게이트웨이 설정(선택) 저장
 *
 * admin 역할 사용자가 1명이라도 있으면 POST 는 403 — 기존 배포에는 영구 무영향.
 * 관리자 생성은 audit `setup.completed`(warning) 로 기록된다.
 *
 * @see docs/superpowers/plans/2026-08-12-first-run-setup.md §B
 */
import { Router, type Request, type Response } from 'express';
import * as path from 'path';
import { z } from 'zod';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, forbidden } from '../utils/api-response';
import { getUserManager } from '../data/user-manager';
import { withAdvisoryLock } from '../data/advisory-lock';
import { FIRST_RUN_SETUP_ADVISORY_LOCK_KEY } from '../config/constants';
import { getSystemSettingsService } from '../services/system-settings-service';
import { SETTING_DEFS_BY_KEY } from '../config/system-settings-registry';
import { getAuditService } from '../services/AuditService';
import { ensureSandboxDefaultOnSetup } from '../mcp/sandbox-bootstrap';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';

const logger = createLogger('FirstRunSetupRoutes');

// ADMIN_PASSWORD 정책과 동일 (8자+, 대문자/숫자/특수문자)
const setupSchema = z.object({
    adminEmail: z.string().trim().email('올바른 이메일 형식이 아닙니다').max(200),
    adminPassword: z
        .string()
        .min(8, '비밀번호는 8자 이상이어야 합니다')
        .max(200)
        .regex(/[A-Z]/, '대문자를 1자 이상 포함해야 합니다')
        .regex(/[0-9]/, '숫자를 1자 이상 포함해야 합니다')
        .regex(/[^A-Za-z0-9]/, '특수문자를 1자 이상 포함해야 합니다'),
    llmBaseUrl: z.string().trim().max(2000).optional(),
    llmApiKey: z.string().trim().max(2000).optional(),
});

function adminExists(): Promise<boolean> {
    return getUserManager().hasAdminUser();
}

export const firstRunSetupRouter = Router();

firstRunSetupRouter.get('/status', asyncHandler(async (_req: Request, res: Response) => {
    const setupNeeded = !(await adminExists());
    // defaults 는 setupNeeded 일 때만 노출 (공개 endpoint 정보 최소화)
    res.json(success(setupNeeded
        ? { setupNeeded, defaults: { llmBaseUrl: getConfig().llmBaseUrl } }
        : { setupNeeded }));
}));

firstRunSetupRouter.post('/', validate(setupSchema), asyncHandler(async (req: Request, res: Response) => {
    // admin 존재 확인 → 생성 사이를 advisory lock 으로 직렬화 — 동시 요청이 각각 "admin 없음"을 보고
    // 복수 관리자를 만드는 경합 차단 (2026-09-02 보안 리뷰 L5). 세션 락이라 전용 client 로 잡는다.
    await withAdvisoryLock(FIRST_RUN_SETUP_ADVISORY_LOCK_KEY, () => runSetup(req, res));
}));

async function runSetup(req: Request, res: Response): Promise<void> {
    if (await adminExists()) {
        res.status(403).json(forbidden('셋업이 이미 완료되었습니다 (관리자 계정 존재)'));
        return;
    }
    const body = req.body as z.infer<typeof setupSchema>;

    // LLM 설정은 관리자 생성 전에 registry 검증만 미리 수행 (생성 후 실패 시 반쪽 상태 방지)
    const llmEntries: Record<string, string> = {};
    if (body.llmBaseUrl) llmEntries.LLM_BASE_URL = body.llmBaseUrl;
    if (body.llmApiKey) llmEntries.LLM_API_KEY = body.llmApiKey;
    for (const [key, raw] of Object.entries(llmEntries)) {
        const parsed = SETTING_DEFS_BY_KEY.get(key)!.validate.safeParse(raw);
        if (!parsed.success) {
            res.status(400).json(badRequest(`'${key}': ${parsed.error.issues[0]?.message ?? '형식 오류'}`));
            return;
        }
        llmEntries[key] = parsed.data;
    }

    const admin = await getUserManager().createUser({
        email: body.adminEmail,
        password: body.adminPassword,
        role: 'admin',
    });
    if (!admin) {
        res.status(400).json(badRequest('해당 이메일의 사용자가 이미 존재합니다'));
        return;
    }

    if (Object.keys(llmEntries).length > 0) {
        await getSystemSettingsService().update(llmEntries, String(admin.id));
    }

    // MCP 샌드박스 secure-by-default — MCP_SANDBOX_ENABLED 미설정 + docker·런타임 이미지
    // 가용일 때만 .env 영속 + 즉시 반영. 전 경로 fail-open(셋업을 죽이지 않음) — 미적용이면
    // 다음 부팅의 sandboxBootAdvisory 경고가 OFF 상태를 다시 드러낸다.
    const sandboxDefault = ensureSandboxDefaultOnSetup(path.resolve(__dirname, '../../../../.env'));
    if (sandboxDefault.applied) {
        logger.info('MCP 샌드박스 기본 활성화 (docker + 런타임 이미지 감지 → MCP_SANDBOX_ENABLED=true 영속)');
    } else if (sandboxDefault.reason !== 'explicit') {
        logger.info(`MCP 샌드박스 자동 활성화 건너뜀: ${sandboxDefault.reason}`);
    }

    try {
        await getAuditService().logAudit({
            action: 'setup.completed',
            userId: String(admin.id),
            resourceType: 'setup',
            details: { adminEmail: body.adminEmail, llmConfigured: Object.keys(llmEntries) },
        });
    } catch (err) {
        logger.error('셋업 완료 감사 기록 실패 (셋업은 완료됨):', err);
    }

    logger.info(`첫 실행 셋업 완료 — 관리자 ${body.adminEmail} 생성`);
    res.json(success({ completed: true }));
}
