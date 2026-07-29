/**
 * 아티팩트 export(pdf/docx) 샌드박스 설정 (No-Hardcoding — env override).
 *
 * P1 보고서 파이프라인 Phase 3: html 아티팩트를 Docker 컨테이너에서 pdf(chromium
 * headless print)·docx(python-docx, reportdata source_data 기반)로 변환한다.
 * task-runtime 이미지 재사용 — playwright chromium + fonts-nanum(한글) + /opt/pyenv
 * (python-docx)이 모두 베이킹돼 있다. artifact-exec 와 동일한 격리 원칙
 * (cap-drop ALL·no-new-privileges·non-root·read-only·network none·memory=memory-swap).
 *
 * @module config/artifact-export
 */

function envNum(v: string | undefined, d: number): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
}

export const ARTIFACT_EXPORT = {
    /** export 기능 게이트 (기본 off — 운영 활성화는 사용자 직접). */
    enabled: process.env.ARTIFACT_EXPORT_ENABLED === 'true',
    /** 변환 런타임 이미지 — task-runtime(chromium+한글폰트+python-docx) 재사용. */
    image: process.env.ARTIFACT_EXPORT_IMAGE || 'openmake-task-runtime:latest',
    /** docker 바이너리 경로/이름 (resolveDocker 로 절대경로 해석). */
    dockerPath: process.env.ARTIFACT_EXPORT_DOCKER_PATH || process.env.MCP_SANDBOX_DOCKER_PATH || 'docker',
    /** 벽시계 변환 제한 — chromium 기동+렌더 포함. 초과 시 SIGKILL. */
    timeoutMs: envNum(process.env.ARTIFACT_EXPORT_TIMEOUT_MS, 60_000),
    /** chromium 렌더 여유 — exec(256m)보다 크게. --memory-swap 동일값으로 swap 차단. */
    memory: process.env.ARTIFACT_EXPORT_MEMORY || '768m',
    cpus: process.env.ARTIFACT_EXPORT_CPUS || '2.0',
    /** chromium 은 멀티프로세스 — exec(128)보다 여유. */
    pidsLimit: envNum(process.env.ARTIFACT_EXPORT_PIDS, 256),
    /** /tmp tmpfs 크기 — chromium 프로필 + 출력 pdf. */
    tmpfsSize: process.env.ARTIFACT_EXPORT_TMPFS || '256m',
    /** 동시 변환 컨테이너 상한 — 초과 시 429(TOO_MANY_CONCURRENT). */
    maxConcurrent: envNum(process.env.ARTIFACT_EXPORT_MAX_CONCURRENT, 2),
    /** 변환 입력(html/source_data JSON) 최대 크기. */
    inputMaxBytes: envNum(process.env.ARTIFACT_EXPORT_INPUT_MAX, 5 * 1024 * 1024),
    /** 변환 출력(base64) 캡 — pdf 수 MB 수준이면 충분. */
    outputMaxBytes: envNum(process.env.ARTIFACT_EXPORT_OUTPUT_MAX, 40 * 1024 * 1024),
    user: process.env.ARTIFACT_EXPORT_USER || '1000:1000',
    /** 레이트 리밋 (변환은 비용이 커 보수적). */
    rateWindowMs: envNum(process.env.ARTIFACT_EXPORT_RATE_WINDOW_MS, 60_000),
    rateUserLimit: envNum(process.env.ARTIFACT_EXPORT_RATE_USER, 10),
    rateIpLimit: envNum(process.env.ARTIFACT_EXPORT_RATE_IP, 15),
} as const;
