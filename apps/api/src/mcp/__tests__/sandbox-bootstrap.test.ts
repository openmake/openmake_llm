/**
 * mcp/sandbox-bootstrap 단위 테스트 — 부팅 자세 점검 + 셋업 secure-by-default.
 * docker/파일시스템은 주입/임시디렉토리로 대체 (실제 docker 불요).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sandboxBootAdvisory, ensureSandboxDefaultOnSetup } from '../sandbox-bootstrap';
import type { SandboxConfig } from '../sandbox-docker';

function cfg(overrides: Partial<SandboxConfig>): SandboxConfig {
    return {
        enabled: false,
        dockerPath: null,
        image: 'openmake-mcp-runtime:latest',
        cacheVolume: 'openmake-mcp-cache',
        memory: '512m',
        pidsLimit: 256,
        cpus: '1.0',
        user: '1000:1000',
        readonly: false,
        ownerPid: 12345,
        ...overrides,
    };
}

describe('sandboxBootAdvisory', () => {
    it('ON + docker 가용 → 경고 없음(null)', () => {
        expect(sandboxBootAdvisory(cfg({ enabled: true, dockerPath: '/usr/local/bin/docker' }))).toBeNull();
    });

    it('ON + docker 부재 → fail-closed 조기 경보', () => {
        const msg = sandboxBootAdvisory(cfg({ enabled: true, dockerPath: null }));
        expect(msg).toContain('거부');
        expect(msg).toContain('fail-closed');
    });

    it('OFF + docker 가용 → 격리 권장 안내', () => {
        const msg = sandboxBootAdvisory(cfg({ enabled: false }), () => '/usr/local/bin/docker');
        expect(msg).toContain('MCP_SANDBOX_ENABLED=true');
        expect(msg).toContain('infra/mcp-runtime');
    });

    it('OFF + docker 부재 → 안내 무의미(null)', () => {
        expect(sandboxBootAdvisory(cfg({ enabled: false }), () => null)).toBeNull();
    });
});

describe('ensureSandboxDefaultOnSetup', () => {
    let tmpDir: string;
    let envPath: string;
    const savedEnabled = process.env.MCP_SANDBOX_ENABLED;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-bootstrap-'));
        envPath = path.join(tmpDir, '.env');
        delete process.env.MCP_SANDBOX_ENABLED;
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (savedEnabled === undefined) delete process.env.MCP_SANDBOX_ENABLED;
        else process.env.MCP_SANDBOX_ENABLED = savedEnabled;
    });

    it('명시 설정(false 포함)은 존중 — 덮어쓰지 않는다', () => {
        process.env.MCP_SANDBOX_ENABLED = 'false';
        const result = ensureSandboxDefaultOnSetup(envPath, {
            resolveDockerPath: () => '/usr/local/bin/docker',
            imageExists: () => true,
        });
        expect(result).toEqual({ applied: false, reason: 'explicit' });
        expect(fs.existsSync(envPath)).toBe(false);
        expect(process.env.MCP_SANDBOX_ENABLED).toBe('false');
    });

    it('docker 부재 → no-docker (미적용)', () => {
        const result = ensureSandboxDefaultOnSetup(envPath, { resolveDockerPath: () => null });
        expect(result).toEqual({ applied: false, reason: 'no-docker' });
        expect(process.env.MCP_SANDBOX_ENABLED).toBeUndefined();
    });

    it('docker 는 있는데 런타임 이미지 부재 → no-image (켜면 spawn 이 깨지므로 미적용)', () => {
        const result = ensureSandboxDefaultOnSetup(envPath, {
            resolveDockerPath: () => '/usr/local/bin/docker',
            imageExists: () => false,
        });
        expect(result).toEqual({ applied: false, reason: 'no-image' });
        expect(process.env.MCP_SANDBOX_ENABLED).toBeUndefined();
    });

    it('docker + 이미지 가용 → .env 영속(기존 파일 append) + process.env 즉시 반영', () => {
        fs.writeFileSync(envPath, 'PORT=52416\n', 'utf-8');
        const result = ensureSandboxDefaultOnSetup(envPath, {
            resolveDockerPath: () => '/usr/local/bin/docker',
            imageExists: () => true,
        });
        expect(result).toEqual({ applied: true, reason: 'applied' });
        const persisted = fs.readFileSync(envPath, 'utf-8');
        expect(persisted).toContain('PORT=52416'); // 기존 내용 보존
        expect(persisted).toContain('MCP_SANDBOX_ENABLED=true');
        expect(process.env.MCP_SANDBOX_ENABLED).toBe('true');
    });

    it('.env 부재 시 새로 생성한다', () => {
        const result = ensureSandboxDefaultOnSetup(envPath, {
            resolveDockerPath: () => '/usr/local/bin/docker',
            imageExists: () => true,
        });
        expect(result.applied).toBe(true);
        expect(fs.readFileSync(envPath, 'utf-8')).toContain('MCP_SANDBOX_ENABLED=true');
    });

    it('영속 실패 → persist-failed (fail-open, throw 하지 않음 + env 미주입)', () => {
        const badPath = path.join(tmpDir, 'no-such-dir', '.env'); // 부모 디렉토리 부재 → 쓰기 실패
        const result = ensureSandboxDefaultOnSetup(badPath, {
            resolveDockerPath: () => '/usr/local/bin/docker',
            imageExists: () => true,
        });
        expect(result).toEqual({ applied: false, reason: 'persist-failed' });
        expect(process.env.MCP_SANDBOX_ENABLED).toBeUndefined();
    });
});

describe('reapOrphanSandboxContainers', () => {
    const { reapOrphanSandboxContainers } = require('../sandbox-bootstrap');
    const docker = '/usr/local/bin/docker';

    function fakeDocker(containers: Array<{ id: string; pid: string }>, stopped: string[]) {
        return (_d: string, args: string[], _t: number): string => {
            if (args[0] === 'ps') return containers.map((c) => c.id).join('\n') + '\n';
            if (args[0] === 'inspect') {
                const c = containers.find((x) => x.id === args[3]);
                return (c?.pid ?? '') + '\n';
            }
            if (args[0] === 'stop') { stopped.push(args[1]); return args[1]; }
            throw new Error(`unexpected: ${args.join(' ')}`);
        };
    }

    it('죽은 pid 소속만 정리하고 생존 pid·판정불가는 남긴다', () => {
        const stopped: string[] = [];
        const result = reapOrphanSandboxContainers({
            resolveDockerPath: () => docker,
            dockerExec: fakeDocker(
                [
                    { id: 'dead1', pid: '99991' },
                    { id: 'alive', pid: '11111' },
                    { id: 'nolab', pid: '<no value>' }, // 라벨 없음 → 보류
                ],
                stopped,
            ),
            pidAlive: (pid: number) => pid === 11111,
        });
        expect(stopped).toEqual(['dead1']);
        expect(result).toEqual({ scanned: 3, reaped: 1, skipped: 1, errors: [] });
    });

    it('docker 부재 → no-op (fail-open)', () => {
        const result = reapOrphanSandboxContainers({ resolveDockerPath: () => null });
        expect(result).toEqual({ scanned: 0, reaped: 0, skipped: 0, errors: [] });
    });

    it('ps 실패 → 오류만 기록하고 throw 하지 않는다', () => {
        const result = reapOrphanSandboxContainers({
            resolveDockerPath: () => docker,
            dockerExec: () => { throw new Error('daemon hang'); },
        });
        expect(result.errors.length).toBe(1);
        expect(result.reaped).toBe(0);
    });

    it('개별 stop 실패는 그 컨테이너만 오류로 남기고 계속 진행한다', () => {
        const stopped: string[] = [];
        const base = fakeDocker([{ id: 'dead1', pid: '99991' }, { id: 'dead2', pid: '99992' }], stopped);
        const result = reapOrphanSandboxContainers({
            resolveDockerPath: () => docker,
            dockerExec: (d: string, args: string[], t: number) => {
                if (args[0] === 'stop' && args[1] === 'dead1') throw new Error('stop failed');
                return base(d, args, t);
            },
            pidAlive: () => false,
        });
        expect(stopped).toEqual(['dead2']);
        expect(result.reaped).toBe(1);
        expect(result.errors.length).toBe(1);
    });
});
