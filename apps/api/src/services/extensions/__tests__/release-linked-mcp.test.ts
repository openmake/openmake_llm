/**
 * releaseLinkedMcpServers — 확장 권한·제거·업데이트 뒤 그 확장의 떠 있는 MCP 연결을 닫는 공용 경로.
 */
import type { Pool } from 'pg';

const mockListLinked = jest.fn();
jest.mock('../../../data/repositories/user-extension-permission-repository', () => ({
    UserExtensionPermissionRepository: jest.fn().mockImplementation(() => ({ listLinkedMcpServerIds: mockListLinked })),
}));
const mockReleaseServers = jest.fn();
jest.mock('../../../runtime-ports/tool-runtime', () => ({ getToolRuntime: () => ({ releaseServers: mockReleaseServers }) }));

import { releaseLinkedMcpServers, listLinkedMcpServerIds } from '../release-linked-mcp';

const pool = {} as Pool;

beforeEach(() => {
    jest.clearAllMocks();
    mockListLinked.mockResolvedValue(['s1', 's2']);
    mockReleaseServers.mockResolvedValue(2);
});

describe('releaseLinkedMcpServers', () => {
    it('대상을 주지 않으면 지금 연결된 서버를 조회해 소유자 기준으로 닫는다', async () => {
        expect(await releaseLinkedMcpServers(pool, 'ext-1', 'u-1')).toBe(2);
        expect(mockListLinked).toHaveBeenCalledWith('ext-1');
        expect(mockReleaseServers).toHaveBeenCalledWith('u-1', ['s1', 's2']);
    });

    it('미리 받아 둔 대상(링크가 끊긴 업데이트)은 다시 조회하지 않는다', async () => {
        await releaseLinkedMcpServers(pool, 'ext-1', 'u-1', ['old-1']);
        expect(mockListLinked).not.toHaveBeenCalled();
        expect(mockReleaseServers).toHaveBeenCalledWith('u-1', ['old-1']);
    });

    it('대상이 없으면 런타임을 부르지 않는다', async () => {
        expect(await releaseLinkedMcpServers(pool, 'ext-1', 'u-1', [])).toBe(0);
        expect(mockReleaseServers).not.toHaveBeenCalled();
    });

    it('조회·정리가 실패해도 throw 하지 않고 0 — 호출자의 DB 변경은 유지된다', async () => {
        mockReleaseServers.mockRejectedValueOnce(new Error('supervisor down'));
        expect(await releaseLinkedMcpServers(pool, 'ext-1', 'u-1')).toBe(0);
        mockListLinked.mockRejectedValueOnce(new Error('db down'));
        expect(await releaseLinkedMcpServers(pool, 'ext-1', 'u-1')).toBe(0);
    });

    it('listLinkedMcpServerIds 는 저장소에 위임한다', async () => {
        expect(await listLinkedMcpServerIds(pool, 'ext-9')).toEqual(['s1', 's2']);
        expect(mockListLinked).toHaveBeenCalledWith('ext-9');
    });
});
