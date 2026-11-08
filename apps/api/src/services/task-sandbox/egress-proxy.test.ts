import { buildEgressProxyRunArgs, isProxyListening } from './egress-proxy';
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

describe('isProxyListening (사용자 MCP 서버 실행 격리 보강, 2026-11-08 점검)', () => {
    it('기동 로그에 해당 포트 listening 줄이 있으면 true', () => {
        expect(isProxyListening('[egress-proxy] listening :8888 allowlist=[(empty) mode=public] ports=[80,443]', 8888)).toBe(true);
        expect(isProxyListening('noise\n[egress-proxy] listening :8888 allowlist=[a.com] ports=[443]\n', 8888)).toBe(true);
    });

    it('다른 포트·빈 로그·접두 포트는 false', () => {
        expect(isProxyListening('[egress-proxy] listening :9999 allowlist=[]', 8888)).toBe(false);
        expect(isProxyListening('', 8888)).toBe(false);
        expect(isProxyListening('[egress-proxy] listening :88881 allowlist=[]', 8888)).toBe(false);
    });
});

describe('egressReadyTimeoutMs 설정', () => {
    const saved = process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS;
    afterEach(() => {
        if (saved === undefined) delete process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS;
        else process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS = saved;
    });

    it('기본 10000, 환경변수로 바꾼다', () => {
        delete process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS;
        expect(getTaskSandboxConfig().egressReadyTimeoutMs).toBe(10_000);
        process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS = '2500';
        expect(getTaskSandboxConfig().egressReadyTimeoutMs).toBe(2500);
    });
});
