/**
 * 아티팩트 코드 실행 샌드박스 설정 (No-Hardcoding — env override).
 *
 * code 아티팩트(python/js)를 Docker 컨테이너에서 one-shot 실행하는 데 쓰는 한계값.
 * MCP 샌드박스(sandbox-docker.ts)와 동일 런타임 이미지를 재사용하되, 실행은 별도
 * 게이트(ARTIFACT_EXEC_ENABLED)로 통제한다 — network none + timeout + 자원상한.
 *
 * @module config/artifact-exec
 */

function envNum(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export const ARTIFACT_EXEC = {
  /** 실행 기능 게이트 (기본 off — 운영 활성화는 사용자 직접). */
  enabled: process.env.ARTIFACT_EXEC_ENABLED === 'true',
  /** 런타임 이미지 — MCP 샌드박스 이미지(node22+python3+uv) 재사용. */
  image: process.env.ARTIFACT_EXEC_IMAGE || process.env.MCP_SANDBOX_IMAGE || 'openmake-mcp-runtime:latest',
  /** docker 바이너리 경로/이름 (resolveDocker 로 절대경로 해석). */
  dockerPath: process.env.ARTIFACT_EXEC_DOCKER_PATH || process.env.MCP_SANDBOX_DOCKER_PATH || 'docker',
  /** 벽시계 실행 제한 — 초과 시 SIGKILL. */
  timeoutMs: envNum(process.env.ARTIFACT_EXEC_TIMEOUT_MS, 10_000),
  memory: process.env.ARTIFACT_EXEC_MEMORY || '256m',
  cpus: process.env.ARTIFACT_EXEC_CPUS || '1.0',
  pidsLimit: envNum(process.env.ARTIFACT_EXEC_PIDS, 128),
  /** 동시 실행 컨테이너 상한 — rate limit(요청/분)과 별개의 자원 축.
   *  각 컨테이너가 cpus·memory 를 점유하므로 동시 spawn 폭주로부터 호스트를 보호한다.
   *  초과 시 429(TOO_MANY_CONCURRENT). Agent Task 샌드박스의 maxConcurrent 대응물. */
  maxConcurrent: envNum(process.env.ARTIFACT_EXEC_MAX_CONCURRENT, 4),
  /** stdout/stderr 각각 캡 (병리적 출력 방지). */
  outputMaxBytes: envNum(process.env.ARTIFACT_EXEC_OUTPUT_MAX, 256 * 1024),
  /** 입력 코드 최대 크기. */
  codeMaxBytes: envNum(process.env.ARTIFACT_EXEC_CODE_MAX, 100 * 1024),
  user: process.env.ARTIFACT_EXEC_USER || '1000:1000',
  /** 레이트 리밋 (실행은 비용이 커 보수적). */
  rateWindowMs: envNum(process.env.ARTIFACT_EXEC_RATE_WINDOW_MS, 60_000),
  rateUserLimit: envNum(process.env.ARTIFACT_EXEC_RATE_USER, 20),
  rateIpLimit: envNum(process.env.ARTIFACT_EXEC_RATE_IP, 30),
} as const;

/**
 * lang(소문자) → 컨테이너 런타임 바이너리. 매핑에 없으면 미지원(실행 거부).
 * Phase 2: python / js 만. network none 이라 외부 패키지 설치 불가 — 표준 라이브러리만.
 */
export const ARTIFACT_EXEC_RUNTIMES: Record<string, string> = {
  python: 'python3',
  py: 'python3',
  python3: 'python3',
  javascript: 'node',
  js: 'node',
  node: 'node',
  nodejs: 'node',
};
