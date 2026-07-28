import { buildExecDockerArgs, resolveRuntime } from '../artifact-exec-service';

describe('resolveRuntime', () => {
  it('python/js 계열을 런타임 바이너리로 매핑', () => {
    expect(resolveRuntime('python')).toBe('python3');
    expect(resolveRuntime('PY')).toBe('python3');
    expect(resolveRuntime('js')).toBe('node');
    expect(resolveRuntime('JavaScript')).toBe('node');
    expect(resolveRuntime('rust')).toBeNull();
    expect(resolveRuntime(null)).toBeNull();
  });
});

describe('buildExecDockerArgs (보안 플래그)', () => {
  const s = buildExecDockerArgs('python3').join(' ');
  it('격리 플래그 일체 포함', () => {
    expect(s).toContain('--network none');           // exfil 차단
    expect(s).toContain('--cap-drop ALL');
    expect(s).toContain('--security-opt no-new-privileges');
    expect(s).toContain('--pids-limit');
    expect(s).toContain('--memory');
    expect(s).toContain('--cpus');
    expect(s).toContain('--user 1000:1000');         // 비-root
    expect(s).toContain('--read-only');
    expect(s).toContain('--tmpfs /tmp:rw,exec');
    expect(s).toContain('--rm');
  });
  it('이미지 뒤에 런타임이 마지막 인자', () => {
    const a = buildExecDockerArgs('node');
    expect(a[a.length - 1]).toBe('node');
  });
});
