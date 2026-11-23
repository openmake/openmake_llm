/**
 * mcpToolRuntime.releaseServers — 설정이 바뀐 서버(확장 권한 철회 등)의 떠 있는 연결을 닫는다.
 * 사용자 풀(supervisor)과 전역 registry 를 모두 보고, 실제로 떠 있던 것만 센다. 한 서버 실패가 나머지를 막지 않는다.
 */
const userClients = new Map<string, object>();
const killUserServer = jest.fn(async (userId: string, id: string) => { userClients.delete(`${userId}:${id}`); });
let supervisorPresent = true;
jest.mock('../lifecycle-supervisor', () => ({
    getLifecycleSupervisor: () => (supervisorPresent ? {
        getUserClient: (userId: string, id: string) => userClients.get(`${userId}:${id}`),
        killUserServer,
    } : null),
}));

const globalClients = new Map<string, object>();
const disconnectServer = jest.fn(async (id: string) => { globalClients.delete(id); });
jest.mock('../index', () => ({
    getUnifiedMCPClient: () => ({ getServerRegistry: () => ({ getClient: (id: string) => globalClients.get(id), disconnectServer }) }),
}));

import { mcpToolRuntime } from '../runtime';

beforeEach(() => {
    jest.clearAllMocks();
    supervisorPresent = true;
    userClients.clear();
    globalClients.clear();
});

describe('mcpToolRuntime.releaseServers', () => {
    it('사용자 풀에 떠 있는 서버만 닫고 닫은 수를 돌려준다', async () => {
        userClients.set('u1:s1', {});
        const closed = await mcpToolRuntime.releaseServers('u1', ['s1', 's2']);
        expect(closed).toBe(1);
        expect(killUserServer).toHaveBeenCalledTimes(1);
        expect(killUserServer).toHaveBeenCalledWith('u1', 's1');
        expect(disconnectServer).not.toHaveBeenCalled();
    });

    it('전역 registry 에 붙은 서버도 끊는다', async () => {
        globalClients.set('s2', {});
        expect(await mcpToolRuntime.releaseServers('u1', ['s2'])).toBe(1);
        expect(disconnectServer).toHaveBeenCalledWith('s2');
    });

    it('한 서버 정리가 실패해도 나머지를 계속 닫는다', async () => {
        userClients.set('u1:s1', {});
        userClients.set('u1:s2', {});
        killUserServer.mockRejectedValueOnce(new Error('kill failed'));
        expect(await mcpToolRuntime.releaseServers('u1', ['s1', 's2'])).toBe(1);
        expect(killUserServer).toHaveBeenCalledTimes(2);
    });

    it('supervisor 미초기화(부팅 직후)면 전역 registry 만 본다', async () => {
        supervisorPresent = false;
        globalClients.set('s1', {});
        expect(await mcpToolRuntime.releaseServers('u1', ['s1'])).toBe(1);
        expect(killUserServer).not.toHaveBeenCalled();
    });
});
