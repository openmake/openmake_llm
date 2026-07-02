/**
 * 아티팩트 코드 실행 서비스 — code 아티팩트(python/js)를 Docker 컨테이너에서
 * one-shot 실행하고 stdout/stderr 를 캡처한다.
 *
 * 보안: `docker run --rm -i --init --network none --cap-drop ALL
 *   --security-opt no-new-privileges --pids-limit --memory --cpus --user 1000:1000
 *   --read-only --tmpfs /tmp` 로 격리. 코드는 인자가 아닌 **stdin** 으로 전달(셸 인젝션
 *   표면 최소화). network none → 외부 exfil 불가. timeout 초과 시 SIGKILL.
 *
 * @module services/artifact-exec-service
 */
import { spawn } from 'child_process';
import { createLogger } from '../utils/logger';
import { resolveDocker } from '../mcp/sandbox-docker';
import { ARTIFACT_EXEC, ARTIFACT_EXEC_RUNTIMES } from '../config/artifact-exec';

const log = createLogger('ArtifactExec');

export interface ArtifactExecResult {
  runtime: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

/** lang → 런타임 바이너리 (미지원이면 null). */
export function resolveRuntime(lang: string | null | undefined): string | null {
  if (!lang) return null;
  return ARTIFACT_EXEC_RUNTIMES[lang.toLowerCase().trim()] ?? null;
}

/** PURE: docker run 인자 조립 (유닛테스트 대상). */
export function buildExecDockerArgs(runtime: string): string[] {
  const c = ARTIFACT_EXEC;
  return [
    'run', '--rm', '-i', '--init',
    '--network', 'none',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', String(c.pidsLimit),
    // --memory-swap 을 --memory 와 같게 설정 → swap 차단. 미설정 시 swap 이 memory 의 2배까지
    // 허용돼 메모리 상한이 무력화된다(600MB 할당이 256m 제한을 통과하던 갭 수정).
    '--memory', c.memory, '--memory-swap', c.memory,
    '--cpus', c.cpus,
    '--user', c.user,
    '--read-only', '--tmpfs', '/tmp:rw,exec,size=64m',
    '-e', 'HOME=/tmp',
    c.image, runtime,
  ];
}

export interface ExecAvailability {
  enabled: boolean;
  dockerPath: string | null;
}

/** 실행 가능 여부 — 게이트 on + docker 바이너리 발견. */
export function execAvailability(): ExecAvailability {
  if (!ARTIFACT_EXEC.enabled) return { enabled: false, dockerPath: null };
  return { enabled: true, dockerPath: resolveDocker(ARTIFACT_EXEC.dockerPath) };
}

function runOnce(dockerPath: string, runtime: string, code: string): Promise<ArtifactExecResult> {
  return new Promise((resolve) => {
    const args = buildExecDockerArgs(runtime);
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    const max = ARTIFACT_EXEC.outputMaxBytes;

    const child = spawn(dockerPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL'); // docker run 종료 → --rm 컨테이너 정리
    }, ARTIFACT_EXEC.timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      if (outBytes < max) {
        outBytes += d.length;
        stdout += d.toString('utf8');
        if (outBytes >= max) { stdout = stdout.slice(0, max); truncated = true; }
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      if (errBytes < max) {
        errBytes += d.length;
        stderr += d.toString('utf8');
        if (errBytes >= max) { stderr = stderr.slice(0, max); truncated = true; }
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      log.warn(`docker spawn 실패: ${e.message}`);
      resolve({ runtime, stdout: '', stderr: `실행 환경 오류: ${e.message}`, exitCode: null, durationMs: Date.now() - started, timedOut, truncated });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        runtime,
        stdout,
        stderr: timedOut ? (stderr + `\n[시간 초과: ${ARTIFACT_EXEC.timeoutMs}ms 내 미완료, 강제 종료]`) : stderr,
        exitCode,
        durationMs: Date.now() - started,
        timedOut,
        truncated,
      });
    });

    // 코드는 stdin 으로 — python3/node 는 파이프된 stdin 을 스크립트로 실행한다.
    child.stdin.on('error', () => { /* EPIPE(조기종료) 무시 */ });
    child.stdin.write(code);
    child.stdin.end();
  });
}

/** 동시 실행 중인 컨테이너 수 — 프로세스 내 세마포어(단일 워커 전제, Agent Task 와 동일 모델). */
let inFlight = 0;

/** 관측/테스트용 — 현재 동시 실행 수. */
export function currentInFlight(): number { return inFlight; }

/**
 * 코드 아티팩트를 컨테이너에서 실행. lang 미지원/게이트 off/docker 부재면 throw.
 * 동시 실행이 maxConcurrent 를 넘으면 429(TOO_MANY_CONCURRENT) — 컨테이너 자원 폭주 방지.
 */
export async function executeArtifactCode(lang: string, code: string): Promise<ArtifactExecResult> {
  const runtime = resolveRuntime(lang);
  if (!runtime) {
    throw new ArtifactExecError(`지원하지 않는 언어: ${lang}`, 400, 'UNSUPPORTED_LANG');
  }
  const { enabled, dockerPath } = execAvailability();
  if (!enabled) {
    throw new ArtifactExecError('코드 실행 기능이 비활성화되어 있습니다', 503, 'EXEC_DISABLED');
  }
  if (!dockerPath) {
    throw new ArtifactExecError('실행 런타임(docker)을 찾을 수 없습니다', 503, 'DOCKER_NOT_FOUND');
  }
  // 동시성 게이트 — rate limit(요청/분)과 별개로 동시 컨테이너 수를 상한한다.
  // 카운터 증가와 runOnce 사이에 await 가 없어 원자적(단일 스레드 이벤트 루프).
  if (inFlight >= ARTIFACT_EXEC.maxConcurrent) {
    throw new ArtifactExecError('동시 실행이 많습니다. 잠시 후 다시 시도하세요.', 429, 'TOO_MANY_CONCURRENT');
  }
  inFlight++;
  try {
    return await runOnce(dockerPath, runtime, code);
  } finally {
    inFlight--;
  }
}

export class ArtifactExecError extends Error {
  constructor(message: string, public statusCode: number, public code: string) {
    super(message);
    this.name = 'ArtifactExecError';
  }
}
