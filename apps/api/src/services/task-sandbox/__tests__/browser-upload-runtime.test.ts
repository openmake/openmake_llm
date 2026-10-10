/**
 * 로컬 브라우저 업로드(uploadFile, 2026-10-06) — 작업 런타임을 지날 때.
 * 업로드는 허용 목록·승인 정책·자동승인·건너뜀과 무관하게 항상 묻고, 승인 카드에 호스트·파일 이름을 싣고,
 * 승인된 호스트·파일 목록만 기기로 보낸다. 서버 샌드박스와 업로드를 모르는 구버전 기기에서는 묻지 않고 "지원하지 않음"을 돌려준다.
 */
import { planBrowserActions } from '@openmake/config';
import { __setChatTurnIntegrationsForTest } from '../../chat-service/turn-integrations';

jest.mock('../../../data/models/unified-database', () => ({
    ...jest.requireActual('../../../data/models/unified-database'),
    getPool: jest.fn(() => ({ query: async () => ({ rows: [], rowCount: 0 }) })),
}));

import { TaskRuntime } from '../runtime';
import { getApprovalRegistry, requiresApproval, type PendingApproval } from '../approval-gate';
import { approvalFloorReason } from '../approval-floor';
import { approvedUploadsOf, withSitePlan } from '../browser-site-approval';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';
import { normalizeCapabilities } from '../../local-bridge/registry';
import { browserPolicyBlockDetails } from '../../local-bridge/browser-policy-audit';
import type { TaskExecutor, ExecResult } from '../executor';

beforeAll(() => __setChatTurnIntegrationsForTest([]));
afterAll(() => __setChatTurnIntegrationsForTest(null));

const POLICY = { allow: ['upload.example.com'], deny: [] };
const tick = () => new Promise((r) => setImmediate(r));
const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 1 });

function localExecutor(supportsBrowserUpload = true) {
    const runBrowserSpec = jest.fn(async (_s: unknown) => ok('{"ok":true,"finalUrl":"https://x/","results":[]}'));
    const executor = {
        taskId: 't', label: 'local:test', localWorkdir: null, isBrowserEnabled: true, browserStatePath: null, supportsBrowserUpload,
        planBrowserSitePolicy: async (actions: readonly unknown[]) => planBrowserActions(actions, null, POLICY),
        runBrowserSpec,
        runBrowser: jest.fn(),
    } as unknown as TaskExecutor;
    return { executor, runBrowserSpec };
}
const runtime = (taskId: string, policy: 'all' | 'high-risk' | 'none', executor: TaskExecutor) =>
    new TaskRuntime(taskId, 'u1', { ...getTaskSandboxConfig(), approvalPolicy: policy }, undefined, undefined, executor, '업로드 작업');

const UPLOAD = [
    { type: 'goto', url: 'https://upload.example.com/form' },
    { type: 'uploadFile', selector: 'input[type=file]', files: ['docs/report.pdf', 'photo.png'] },
];

describe('TaskRuntime — 로컬 브라우저 업로드', () => {
    it.each(['none', 'high-risk', 'all'] as const)('허용 목록 사이트여도 정책 %s 에서 승인 카드가 뜨고, 호스트·파일 이름이 실린다', async (policy) => {
        const { executor, runBrowserSpec } = localExecutor();
        let pending: PendingApproval | undefined;
        const exec = runtime(`t-up-${policy}`, policy, executor).executeTaskTool('browser', { actions: UPLOAD }, { onApprovalPending: (p) => { pending = p; } });
        await tick(); await tick();
        expect(pending?.toolName).toBe('browser');
        expect((pending?.args as { siteUploads: unknown }).siteUploads).toEqual([{ index: 1, host: 'upload.example.com', files: ['docs/report.pdf', 'photo.png'] }]);
        expect(runBrowserSpec).not.toHaveBeenCalled();
        await getApprovalRegistry().approve(pending!.approvalId);
        await exec;
        expect(runBrowserSpec).toHaveBeenCalledWith({
            actions: UPLOAD, approvedHosts: [], approvedUploads: [{ host: 'upload.example.com', files: ['docs/report.pdf', 'photo.png'] }],
        });
    });

    it('자동승인(나머지 모두 승인) 작업에서도 묻는다', async () => {
        const { executor, runBrowserSpec } = localExecutor();
        getApprovalRegistry().setAutoApprove('t-up-auto', true);
        let pending: PendingApproval | undefined;
        const exec = runtime('t-up-auto', 'high-risk', executor).executeTaskTool('browser', { actions: UPLOAD }, { onApprovalPending: (p) => { pending = p; } });
        await tick(); await tick();
        expect(pending).toBeDefined();
        await getApprovalRegistry().reject(pending!.approvalId, 'u1');
        await exec;
        expect(runBrowserSpec).not.toHaveBeenCalled();
        getApprovalRegistry().clearAutoApprove('t-up-auto');
    });

    it('승인은 그 호출에만 — 같은 인자의 다음 호출은 다시 묻는다', async () => {
        const { executor, runBrowserSpec } = localExecutor();
        const rt = runtime('t-up-once', 'none', executor);
        for (let n = 0; n < 2; n++) {
            let pending: PendingApproval | undefined;
            const exec = rt.executeTaskTool('browser', { actions: UPLOAD }, { onApprovalPending: (p) => { pending = p; } });
            await tick(); await tick();
            expect(pending).toBeDefined();
            await getApprovalRegistry().approve(pending!.approvalId);
            await exec;
        }
        expect(runBrowserSpec).toHaveBeenCalledTimes(2);
    });

    it('업로드를 모르는 구버전 기기 — 묻지 않고 "지원하지 않음"을 돌려준다', async () => {
        const { executor, runBrowserSpec } = localExecutor(false);
        const out = await runtime('t-up-old', 'none', executor).executeTaskTool('browser', { actions: UPLOAD }, { onApprovalPending: () => { throw new Error('묻지 않아야 한다'); } });
        expect(out).toMatch(/업로드를 지원하지 않습니다/);
        expect(runBrowserSpec).not.toHaveBeenCalled();
    });

    it('서버 샌드박스 브라우저 — 묻지 않고 "지원하지 않음"을 돌려준다', async () => {
        const runBrowser = jest.fn();
        const executor = { taskId: 't', label: 'sandbox', localWorkdir: null, isBrowserEnabled: true, browserStatePath: null, runBrowser } as unknown as TaskExecutor;
        const out = await runtime('t-up-sandbox', 'none', executor).executeTaskTool('browser', { actions: UPLOAD }, { onApprovalPending: () => { throw new Error('묻지 않아야 한다'); } });
        expect(out).toMatch(/업로드는 사용자 PC/);
        expect(runBrowser).not.toHaveBeenCalled();
    });
});

describe('업로드 승인 판정 (PURE)', () => {
    const plan = planBrowserActions(UPLOAD, null, POLICY);
    const gateArgs = withSitePlan({ actions: UPLOAD, siteUploads: [{ host: 'evil', files: [] }] }, plan);

    it('모델이 넣은 siteUploads 는 서버 계산값으로 덮어쓴다', () => {
        expect(gateArgs.siteUploads).toEqual(plan.uploads);
        expect(withSitePlan({ actions: [], siteUploads: [{ host: 'x', files: [] }] }, planBrowserActions([], null, POLICY))).not.toHaveProperty('siteUploads');
    });

    it('바닥(site_upload)은 정책 none·환경 설정과 무관하게 묻는다', () => {
        expect(approvalFloorReason('browser', gateArgs)).toBe('site_upload');
        expect(requiresApproval('none', 'browser', gateArgs, { siteGoverned: true })).toBe(true);
        expect(requiresApproval('high-risk', 'browser', gateArgs, { siteGoverned: true })).toBe(true);
    });

    it('호스트를 알 수 없는 업로드는 기기로 보내지 않는다', () => {
        expect(approvedUploadsOf([{ index: 0, host: '', files: ['a'] }, { index: 1, host: 'h', files: ['b'] }])).toEqual([{ host: 'h', files: ['b'] }]);
    });
});

describe('기기 능력·감사 기록', () => {
    it('능력 목록의 browser_upload 를 남긴다(모르는 값은 버린다)', () => {
        expect([...normalizeCapabilities(['browser', 'browser_upload', 'nope'])!]).toEqual(['browser', 'browser_upload']);
    });

    it.each(['upload_unapproved', 'upload_rejected'])('업로드 거절(%s)을 감사 기록에 남긴다 — 호스트·동작 종류만', (kind) => {
        const d = browserPolicyBlockDetails({ ok: true, policyBlock: { kind, host: 'upload.example.com', action: 'uploadFile' } } as never, 't1', 'd1');
        expect(d).toEqual({ taskId: 't1', deviceId: 'd1', host: 'upload.example.com', actionType: 'uploadFile', kind });
    });
});
