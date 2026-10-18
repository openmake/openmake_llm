/**
 * 에이전트 작업 기여 도구의 실행 게이트 — 작업을 만들 때 노출된 도구라도, 호출 시점에 add-on 이 꺼졌거나 조직 허용 목록
 * 밖이거나 상태를 알 수 없으면 승인 전 검사에서 거절하고 add-on 의 run 을 부르지 않는다(설계 문서 8.4).
 */
const integrationGate = jest.fn();
jest.mock('../../addon/integration-gate', () => ({ integrationGate: (...a: unknown[]) => integrationGate(...a) }));
const isAddonEnabledSync = jest.fn((_id: string) => true);
jest.mock('../../addon/addon-state', () => ({ isAddonEnabledSync: (id: string) => isAddonEnabledSync(id) }));

import { __setChatTurnIntegrationsForTest, getActiveAgentTaskTools } from '../turn-integrations';

const ctx = { userId: 'u1' };
const run = jest.fn(async (args: Record<string, unknown>) => ({ text: `ran ${String(args.topic)}` }));
const innerPrecheck = jest.fn(async (args: Record<string, unknown>) => (args.topic ? null : 'topic 이 필요합니다'));

beforeEach(() => {
    jest.clearAllMocks();
    integrationGate.mockResolvedValue({ allowed: true });
    isAddonEnabledSync.mockImplementation(() => true);
    __setChatTurnIntegrationsForTest([
        {
            id: 'demo-addon',
            agentTaskTools: () => [
                { tool: { name: 'demo_tool', description: 'd', inputSchema: { type: 'object', properties: {} } }, run, precheck: innerPrecheck },
            ],
        },
        {
            id: 'plain-addon',
            agentTaskTools: () => [{ tool: { name: 'plain_tool', description: 'd', inputSchema: { type: 'object', properties: {} } }, run }],
        },
    ]);
});
afterEach(() => __setChatTurnIntegrationsForTest(null));

const toolNamed = (name: string) => getActiveAgentTaskTools().find((t) => t.tool.name === name)!;

describe('getActiveAgentTaskTools 실행 게이트', () => {
    it('켜진 add-on 의 도구는 게이트를 거친 뒤 원래 검사와 run 을 그대로 쓴다', async () => {
        const t = toolNamed('demo_tool');
        expect(await t.precheck!({ topic: 'x' }, ctx)).toBeNull();
        expect(await t.precheck!({}, ctx)).toBe('topic 이 필요합니다');
        expect(await t.run({ topic: 'x' }, ctx)).toEqual({ text: 'ran x' });
        expect(integrationGate).toHaveBeenCalledWith('demo-addon', 'u1');
        expect(run).toHaveBeenCalledWith({ topic: 'x' }, ctx);
    });

    it('precheck 가 없던 도구도 게이트용 precheck 를 갖는다(켜져 있으면 통과)', async () => {
        expect(await toolNamed('plain_tool').precheck!({}, ctx)).toBeNull();
        expect(integrationGate).toHaveBeenCalledWith('plain-addon', 'u1');
    });

    it.each([
        ['disabled', "add-on 'demo-addon' 이 관리자에 의해 중지되어 이 도구를 실행할 수 없습니다"],
        ['failed', "add-on 'demo-addon' 이 이 서버에서 준비되지 않아(부팅 실패 또는 재시작 필요) 이 도구를 실행할 수 없습니다"],
        ['not_entitled', "add-on 'demo-addon' 은 이 조직에서 사용할 수 없습니다(허용 목록 밖)"],
        ['state_unknown', "add-on 'demo-addon' 상태를 확인할 수 없어 이 도구를 실행하지 않았습니다. 잠시 후 다시 시도하세요"],
    ])('%s 이면 승인 전 검사에서 거절하고 run 을 부르지 않는다', async (reason, message) => {
        integrationGate.mockResolvedValue({ allowed: false, reason });
        const t = toolNamed('demo_tool');
        expect(await t.precheck!({ topic: 'x' }, ctx)).toBe(message);
        expect(await t.run({ topic: 'x' }, ctx)).toEqual({ text: message, isError: true });
        expect(innerPrecheck).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
    });

    it('검사 뒤 실행 전에 꺼지면 run 직전 게이트가 막는다', async () => {
        const t = toolNamed('demo_tool');
        expect(await t.precheck!({ topic: 'x' }, ctx)).toBeNull();
        integrationGate.mockResolvedValue({ allowed: false, reason: 'disabled' });
        expect((await t.run({ topic: 'x' }, ctx)).isError).toBe(true);
        expect(run).not.toHaveBeenCalled();
    });

    it('작업을 만들 때 상태 캐시에서 꺼진 add-on 의 도구는 노출하지 않는다(종전 동작)', () => {
        isAddonEnabledSync.mockImplementation((id) => id !== 'demo-addon');
        expect(getActiveAgentTaskTools().map((t) => t.tool.name)).toEqual(['plain_tool']);
    });
});
