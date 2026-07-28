/**
 * server-registry 의 env 복호화 회귀 가드.
 *
 * rowToConfig 가 DB 원본(암호문 v1:)을 그대로 넘기면, 서버는 뜨고 도구 목록도 정상
 * 등록되지만 실제 API 호출만 인증 실패하는 형태로 조용히 깨진다. 진단이 어려운
 * 실패 모드라 값이 평문으로 전달되는지 직접 검증한다.
 *
 * rowToConfig 는 모듈 내부 함수라 initializeFromDB 를 통해 간접 검증한다.
 */
import { encryptToken } from '../../utils/token-crypto';

const connectServer = jest.fn();

jest.mock('../external-client', () => ({
    ExternalMCPClient: jest.fn(),
}));

import { MCPServerRegistry } from '../server-registry';
import type { UnifiedDatabase } from '../../data/models/unified-database';

const makeRow = (env: Record<string, string> | null) => ({
    id: 'srv1',
    name: 'test-server',
    transport_type: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env,
    url: null,
    enabled: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    sandbox_network: 'full',
});

const makeDb = (rows: unknown[]) => ({
    getGlobalMcpServers: jest.fn().mockResolvedValue(rows),
}) as unknown as UnifiedDatabase;

describe('server-registry env 복호화', () => {
    let registry: MCPServerRegistry;

    beforeEach(() => {
        connectServer.mockReset().mockResolvedValue(undefined);
        registry = new MCPServerRegistry({ registerExternalTools: jest.fn(), unregisterExternalTools: jest.fn() } as never);
        // connectServer 는 실제 프로세스를 띄우므로 대체하고 전달된 config 만 관찰한다.
        (registry as unknown as { connectServer: unknown }).connectServer = connectServer;
    });

    it('암호문(v1:) env 를 평문으로 복호화해 전달한다', async () => {
        const cipher = encryptToken('super-secret-key');
        expect(cipher.startsWith('v1:')).toBe(true);

        await registry.initializeFromDB(makeDb([makeRow({ API_KEY: cipher })]));

        expect(connectServer).toHaveBeenCalledTimes(1);
        const config = connectServer.mock.calls[0]![1] as { env: Record<string, string> };
        expect(config.env.API_KEY).toBe('super-secret-key');
        expect(config.env.API_KEY.startsWith('v1:')).toBe(false);
    });

    it('평문 env 는 그대로 둔다', async () => {
        await registry.initializeFromDB(makeDb([makeRow({ TIMEOUT: '30', MODE: 'stdio' })]));

        const config = connectServer.mock.calls[0]![1] as { env: Record<string, string> };
        expect(config.env).toEqual({ TIMEOUT: '30', MODE: 'stdio' });
    });

    it('env 가 없으면 undefined 로 넘긴다', async () => {
        await registry.initializeFromDB(makeDb([makeRow(null)]));

        const config = connectServer.mock.calls[0]![1] as { env?: unknown };
        expect(config.env).toBeUndefined();
    });

    it('한 서버의 복호화가 실패해도 나머지 서버는 계속 초기화한다', async () => {
        // 손상된 암호문 — decryptToken 이 throw 한다.
        const broken = makeRow({ API_KEY: 'v1:not-a-valid-ciphertext' });
        const healthy = { ...makeRow({ OK: 'yes' }), id: 'srv2', name: 'healthy-server' };

        await registry.initializeFromDB(makeDb([broken, healthy]));

        // 깨진 서버는 건너뛰고 정상 서버만 연결 시도
        expect(connectServer).toHaveBeenCalledTimes(1);
        expect((connectServer.mock.calls[0]![1] as { name: string }).name).toBe('healthy-server');
    });
});
