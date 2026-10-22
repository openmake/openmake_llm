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

    it('허용 목록이 비고 public 모드면 EGRESS_ALLOWLIST_MODE=public 을 넘긴다', () => {
        const j = buildEgressProxyRunArgs({ ...cfg, egressAllowlist: [], egressPublicWhenEmpty: true }).join(' ');
        expect(j).toContain('-e EGRESS_ALLOWLIST_MODE=public');
    });

    it('허용 목록이 비어도 egressPublicWhenEmpty=false 면 모드를 넘기지 않는다(전부 거부)', () => {
        const j = buildEgressProxyRunArgs({ ...cfg, egressAllowlist: [], egressPublicWhenEmpty: false }).join(' ');
        expect(j).not.toContain('EGRESS_ALLOWLIST_MODE');
    });
});

describe('egressProxyEnabled 기본값(W3 S6)', () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const saved = process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED;
    afterEach(() => {
        process.env.NODE_ENV = savedNodeEnv;
        if (saved === undefined) delete process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED;
        else process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED = saved;
    });

    it('운영에서 미설정이면 켜지고, false 를 명시하면 꺼진다', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED;
        expect(getTaskSandboxConfig().egressProxyEnabled).toBe(true);
        process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED = 'false';
        expect(getTaskSandboxConfig().egressProxyEnabled).toBe(false);
    });

    it('dev/test 는 미설정이면 꺼진 채다', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED;
        expect(getTaskSandboxConfig().egressProxyEnabled).toBe(false);
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
