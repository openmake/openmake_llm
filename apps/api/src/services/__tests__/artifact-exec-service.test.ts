import { buildExecDockerArgs, resolveRuntime, runOnce } from '../artifact-exec-service';

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

describe('runOnce — 출력 조각 이어 디코드·상한(UTF-8 청크 경계)', () => {
  // 자식이 다바이트 글자를 바이트 중간에서 끊어 따로 쓴다 — 조각마다 문자열로 바꾸면 경계가 U+FFFD 로 깨진다
  const splitWriter = (text: string, at: number, stream: 'stdout' | 'stderr' = 'stdout'): string =>
    `{ const b = Buffer.from(${JSON.stringify(text)}); process.${stream}.write(b.subarray(0, ${at}));`
    + ` setTimeout(() => process.${stream}.write(b.subarray(${at})), 50); }`;
  const run = (script: string, cap = 1000) => runOnce(process.execPath, ['-e', script], 'node', '', cap);

  it('다바이트 글자가 조각 경계에 걸려도 stdout·stderr 가 원문과 같다', async () => {
    const r = await run(`${splitWriter('한글 출력', 4)} ${splitWriter('오류 글', 2, 'stderr')}`);
    expect(r).toMatchObject({ stdout: '한글 출력', stderr: '오류 글', truncated: false, exitCode: 0 });
  });

  it('상한은 디코드된 글자 수(UTF-16 단위)다 — 직전·딱·직후', async () => {
    expect(await run(splitWriter('가나다라', 5), 5)).toMatchObject({ stdout: '가나다라', truncated: false });
    expect(await run(splitWriter('가나다라', 5), 4)).toMatchObject({ stdout: '가나다라', truncated: false });
    expect(await run(splitWriter('가나다라', 5), 3)).toMatchObject({ stdout: '가나다', truncated: true });
  });

  it('상한이 대리 쌍 한가운데면 그 글자를 통째로 뺀다', async () => {
    expect(await run(splitWriter('😀😀', 2), 3)).toMatchObject({ stdout: '😀', truncated: true });
  });

  it('한 스트림이 상한에 닿으면 그 뒤 조각은 붙이지 않는다(가운데가 빠진 출력 금지)', async () => {
    const r = await run('process.stdout.write("가나"); setTimeout(() => process.stdout.write("a"), 50)', 1);
    expect(r).toMatchObject({ stdout: '가', truncated: true });
  });
});
