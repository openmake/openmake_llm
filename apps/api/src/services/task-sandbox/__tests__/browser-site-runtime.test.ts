/**
 * 로컬 브라우저의 사이트 정책 승인 (Companion P2) — 작업 런타임을 지날 때.
 * 허용 목록 밖 쓰기는 승인 정책·자동승인과 무관하게 사용자에게 묻고, 승인 카드에 사이트와 내용을 싣고,
 * 승인된 호스트만 기기로 보낸다. 모델이 인자에 같은 필드를 넣어 와도 서버 계산값으로 덮어쓴다.
 */
import { planBrowserActions } from '@openmake/config';
import { __setChatTurnIntegrationsForTest } from '../../chat-service/turn-integrations';

jest.mock('../../../data/models/unified-database', () => ({
    ...jest.requireActual('../../../data/models/unified-database'),
    getPool: jest.fn(() => ({ query: async () => ({ rows: [], rowCount: 0 }) })), // 브라우저 계측 등 부가 기록이 쓴다
}));

import { TaskRuntime } from '../runtime';
import { getApprovalRegistry, requiresApproval, type PendingApproval } from '../approval-gate';
import { approvalFloorReason } from '../approval-floor';
import { approvedHostsOf, areSiteWritesApproved, hasOffListSiteWrites, markSiteWritesApproved, withSitePlan } from '../browser-site-approval';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';
import type { TaskExecutor, ExecResult } from '../executor';

beforeAll(() => __setChatTurnIntegrationsForTest([]));
afterAll(() => __setChatTurnIntegrationsForTest(null));

const POLICY = { allow: ['groupware.example.co.kr'], deny: [] };
const tick = () => new Promise((r) => setImmediate(r));
const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 1 });

function localExecutor() {
    const runBrowserSpec = jest.fn(async (_s: { actions: unknown[]; approvedHosts: string[] }) => ok('{"ok":true,"finalUrl":"https://x/","results":[]}'));
    const executor = {
        taskId: 't', label: 'local:test', localWorkdir: null, isBrowserEnabled: true, browserStatePath: null,
        planBrowserSitePolicy: async (actions: readonly unknown[]) => planBrowserActions(actions, null, POLICY),
        runBrowserSpec,
        runBrowser: jest.fn(),
    } as unknown as TaskExecutor;
    return { executor, runBrowserSpec };
}
const runtime = (taskId: string, policy: 'all' | 'high-risk' | 'none', executor: TaskExecutor) =>
    new TaskRuntime(taskId, 'u1', { ...getTaskSandboxConfig(), approvalPolicy: policy }, undefined, undefined, executor, '브라우저 작업');

const OFF_LIST = [{ type: 'goto', url: 'https://translate.example.com/' }, { type: 'fill', selector: 'textarea', text: '사내 문서 문장' }];
const ON_LIST = [{ type: 'goto', url: 'https://groupware.example.co.kr/write' }, { type: 'fill', selector: '#title', text: '보고' }];
const READ_ONLY = [{ type: 'goto', url: 'https://news.example.com/a' }, { type: 'extractText' }];

describe('TaskRuntime — 로컬 브라우저 사이트 정책', () => {
    it('허용 목록 밖 쓰기는 정책 none 에서도 승인 카드가 뜨고, 사이트와 입력 내용이 실린다', async () => {
        const { executor, runBrowserSpec } = localExecutor();
        const rt = runtime('t-site-none', 'none', executor);
        let pending: PendingApproval | undefined;
        const exec = rt.executeTaskTool('browser', { actions: OFF_LIST }, { onApprovalPending: (p) => { pending = p; } });
        await tick(); await tick();
        expect(pending?.toolName).toBe('browser');
        const writes = (pending?.args as { offListWrites: Array<{ host: string; detail: string }> }).offListWrites;
        expect(writes).toEqual([expect.objectContaining({ host: 'translate.example.com', type: 'fill' })]);
        expect(writes[0].detail).toContain('사내 문서 문장');
        expect(runBrowserSpec).not.toHaveBeenCalled();
        await getApprovalRegistry().approve(pending!.approvalId);
        await exec;
        expect(runBrowserSpec).toHaveBeenCalledWith({ actions: OFF_LIST, approvedHosts: ['translate.example.com'] });
    });

    it('거절하면 실행하지 않는다', async () => {
        const { executor, runBrowserSpec } = localExecutor();
        const rt = runtime('t-site-reject', 'none', executor);
        let pending: PendingApproval | undefined;
        const exec = rt.executeTaskTool('browser', { actions: OFF_LIST }, { onApprovalPending: (p) => { pending = p; } });
        await tick(); await tick();
        await getApprovalRegistry().reject(pending!.approvalId, 'u1');
        await exec;
        expect(runBrowserSpec).not.toHaveBeenCalled();
    });

    it('자동승인 작업에서도 묻는다', async () => {
        const { executor, runBrowserSpec } = localExecutor();
        const rt = runtime('t-site-auto', 'all', executor);
        getApprovalRegistry().setAutoApprove('t-site-auto', true);
        let pending: PendingApproval | undefined;
        const exec = rt.executeTaskTool('browser', { actions: OFF_LIST }, { onApprovalPending: (p) => { pending = p; } });
        await tick(); await tick();
        expect(pending).toBeDefined();
        expect(runBrowserSpec).not.toHaveBeenCalled();
        await getApprovalRegistry().reject(pending!.approvalId, 'u1');
        await exec;
        getApprovalRegistry().clearAutoApprove('t-site-auto');
    });

    it('허용 목록 사이트의 쓰기·목록 밖 읽기는 정책 none 에서 묻지 않고 실행한다(승인 호스트 없음)', async () => {
        for (const actions of [ON_LIST, READ_ONLY]) {
            const { executor, runBrowserSpec } = localExecutor();
            const out = await runtime(`t-site-free-${actions.length}-${Math.random()}`, 'none', executor).executeTaskTool('browser', { actions }, { onApprovalPending: () => { throw new Error('묻지 않아야 한다'); } });
            expect(out).not.toMatch(/^Error/);
            expect(runBrowserSpec).toHaveBeenCalledWith({ actions, approvedHosts: [] });
        }
    });

    it('정책 high-risk(자동) — 읽기·허용 목록 쓰기는 묻지 않고, 목록 밖 쓰기는 묻는다', async () => {
        for (const actions of [ON_LIST, READ_ONLY]) {
            const { executor, runBrowserSpec } = localExecutor();
            const out = await runtime(`t-site-auto-${actions.length}-${Math.random()}`, 'high-risk', executor).executeTaskTool('browser', { actions }, { onApprovalPending: () => { throw new Error('묻지 않아야 한다'); } });
            expect(out).not.toMatch(/^Error/);
            expect(runBrowserSpec).toHaveBeenCalledTimes(1);
        }
        const { executor, runBrowserSpec } = localExecutor();
        let pending: PendingApproval | undefined;
        const exec = runtime('t-site-auto-write', 'high-risk', executor).executeTaskTool('browser', { actions: OFF_LIST }, { onApprovalPending: (p) => { pending = p; } });
        await tick(); await tick();
        expect(pending).toBeDefined();
        await getApprovalRegistry().reject(pending!.approvalId, 'u1');
        await exec;
        expect(runBrowserSpec).not.toHaveBeenCalled();
    });

    it('정책 all(수동) — 읽기도 종전대로 묻는다', async () => {
        const { executor, runBrowserSpec } = localExecutor();
        let pending: PendingApproval | undefined;
        const exec = runtime('t-site-manual-read', 'all', executor).executeTaskTool('browser', { actions: READ_ONLY }, { onApprovalPending: (p) => { pending = p; } });
        await tick(); await tick();
        expect(pending).toBeDefined();
        await getApprovalRegistry().reject(pending!.approvalId, 'u1');
        await exec;
        expect(runBrowserSpec).not.toHaveBeenCalled();
    });

    it('모델이 offListWrites 를 빈 배열로 넣어 와도 서버 계산값으로 덮어쓴다', async () => {
        const { executor, runBrowserSpec } = localExecutor();
        const rt = runtime('t-site-spoof', 'none', executor);
        let pending: PendingApproval | undefined;
        const exec = rt.executeTaskTool('browser', { actions: OFF_LIST, offListWrites: [] }, { onApprovalPending: (p) => { pending = p; } });
        await tick(); await tick();
        expect((pending?.args as { offListWrites: unknown[] }).offListWrites).toHaveLength(1);
        await getApprovalRegistry().reject(pending!.approvalId, 'u1');
        await exec;
        expect(runBrowserSpec).not.toHaveBeenCalled();
    });

    it('http(s) 가 아닌 이동은 승인과 무관하게 실행하지 않는다', async () => {
        const { executor, runBrowserSpec } = localExecutor();
        const out = await runtime('t-site-file', 'none', executor).executeTaskTool('browser', { actions: [{ type: 'goto', url: 'file:///Users/me/.ssh/id_rsa' }, { type: 'extractText' }] });
        expect(out).toContain('이동할 수 없습니다');
        expect(runBrowserSpec).not.toHaveBeenCalled();
    });
});

describe('승인 바닥·결속 (PURE)', () => {
    it('offListWrites 가 있는 browser 호출은 site_write 바닥이고 정책 none 에서도 승인이 필요하다', () => {
        const args = { actions: OFF_LIST, offListWrites: [{ index: 1, type: 'fill', host: 'a.com', detail: 'x' }] };
        expect(approvalFloorReason('browser', args)).toBe('site_write');
        expect(requiresApproval('none', 'browser', args)).toBe(true);
        expect(approvalFloorReason('browser', { actions: ON_LIST })).toBeNull();
        expect(requiresApproval('none', 'browser', { actions: ON_LIST })).toBe(false);
    });
    it('siteGoverned 는 high-risk 의 browser 에만 듣는다 — 서버 샌드박스 브라우저(표식 없음)·다른 도구·정책 all 은 종전대로', () => {
        expect(requiresApproval('high-risk', 'browser', { actions: READ_ONLY }, { siteGoverned: true })).toBe(false);
        expect(requiresApproval('high-risk', 'browser', { actions: READ_ONLY })).toBe(true);
        expect(requiresApproval('all', 'browser', { actions: READ_ONLY }, { siteGoverned: true })).toBe(true);
        expect(requiresApproval('high-risk', 'bash', {}, { siteGoverned: true })).toBe(true);
    });
    it('다른 도구의 같은 이름 필드는 바닥이 아니다', () => {
        expect(hasOffListSiteWrites('bash', { offListWrites: [{}] })).toBe(false);
    });
    it('withSitePlan — 쓰기가 없으면 필드를 지우고, 있으면 서버 값만 싣는다', () => {
        expect(withSitePlan({ actions: [], offListWrites: ['가짜'] }, { blocked: [], offListWrites: [], uploads: [] })).toEqual({ actions: [] });
        const w = [{ index: 0, type: 'fill', host: 'a.com', detail: 'd' }];
        expect(withSitePlan({ actions: [], offListWrites: [] }, { blocked: [], offListWrites: w, uploads: [] })).toEqual({ actions: [], offListWrites: w });
    });
    it('approvedHostsOf — 중복을 없애고, 호스트를 모르는 쓰기는 뺀다', () => {
        expect(approvedHostsOf([{ index: 0, type: 'fill', host: 'a.com', detail: '' }, { index: 1, type: 'click', host: 'a.com', detail: '' }, { index: 2, type: 'press', host: '', detail: '' }])).toEqual(['a.com']);
    });
    it('승인 표식은 인자 객체 단위다 — 같은 내용의 다른 객체는 승인된 것이 아니다', () => {
        const a = { actions: OFF_LIST };
        markSiteWritesApproved(a);
        expect(areSiteWritesApproved(a)).toBe(true);
        expect(areSiteWritesApproved({ actions: OFF_LIST })).toBe(false);
    });
});
