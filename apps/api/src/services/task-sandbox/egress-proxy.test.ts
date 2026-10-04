import { buildEgressProxyRunArgs } from './egress-proxy';
import { getTaskSandboxConfig } from '../../config/task-sandbox';

describe('buildEgressProxyRunArgs', () => {
    const cfg = { ...getTaskSandboxConfig(), egressAllowlist: ['example.com', 'github.com'], egressAllowedPorts: [80, 443] };

    it('허용 도메인과 허용 포트를 프록시 컨테이너에 넘긴다', () => {
        const j = buildEgressProxyRunArgs(cfg).join(' ');
        expect(j).toContain('-e EGRESS_ALLOWLIST=example.com,github.com');
        expect(j).toContain('-e EGRESS_ALLOWED_PORTS=80,443');
    });

    it('internal 망에 권한을 줄여 띄우고 이미지가 마지막 인자다', () => {
        const r = buildEgressProxyRunArgs(cfg);
        expect(r.slice(0, 4)).toEqual(['run', '-d', '--name', cfg.egressProxyContainer]);
        expect(r.join(' ')).toContain(`--network ${cfg.egressNetwork}`);
        expect(r.join(' ')).toContain('--cap-drop ALL');
        expect(r[r.length - 1]).toBe(cfg.egressProxyImage);
    });
});

describe('egressAllowedPorts 설정', () => {
    const saved = process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS;
    afterEach(() => {
        if (saved === undefined) delete process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS;
        else process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS = saved;
    });

    it('기본은 80·443', () => {
        delete process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS;
        expect(getTaskSandboxConfig().egressAllowedPorts).toEqual([80, 443]);
    });

    it('환경변수로 바꾸고 숫자가 아닌 값은 버린다', () => {
        process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS = '443, 8443, abc';
        expect(getTaskSandboxConfig().egressAllowedPorts).toEqual([443, 8443]);
    });
});
