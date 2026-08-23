/**
 * Local Bridge 설정 — Cowork 트랙 D1a (No-Hardcoding L1/L2).
 *
 * 데스크톱(또는 임의 브리지 클라이언트)이 채팅 WS 로 접속해 등록한 "로컬 실행기"로
 * Agent Task 도구 호출을 위임하는 기능의 게이트·한도.
 *
 * @module config/local-bridge
 */

export const LOCAL_BRIDGE = {
    /** 기능 게이트 — 기본 OFF. executor='local' 작업 생성/실행 허용 여부. */
    ENABLED: process.env.LOCAL_EXECUTOR_ENABLED === 'true',

    /** 브리지 요청(도구 1회) 응답 대기 상한(ms). bash 장기 명령을 고려해 exec 타임아웃보다 여유. */
    REQUEST_TIMEOUT_MS: parseInt(process.env.LOCAL_BRIDGE_REQUEST_TIMEOUT_MS || '180000', 10),

    /** write/importFile 1회 전송 상한(bytes) — WS 페이로드 폭주 방지. */
    MAX_WRITE_BYTES: parseInt(process.env.LOCAL_BRIDGE_MAX_WRITE_BYTES || String(8 * 1024 * 1024), 10),

    /** read/exec 결과 수신 캡(chars) — 모델 컨텍스트/스텝 저장 보호(샌드박스 outputCap 관행과 동일 축). */
    OUTPUT_CAP: parseInt(process.env.LOCAL_BRIDGE_OUTPUT_CAP || '65536', 10),

    /** 유저당 동시 등록 브리지 디바이스 상한 (데스크톱+CLI 병존, 2026-08-21 다중화). */
    MAX_DEVICES: parseInt(process.env.LOCAL_BRIDGE_MAX_DEVICES || '3', 10),

    /** 폴더 선택(folders kind) 1회 열거 상한 — 초과분은 절단 + truncated 플래그(디바이스측 강제). */
    FOLDERS_MAX_ENTRIES: parseInt(process.env.BRIDGE_FOLDERS_MAX_ENTRIES || '200', 10),

    /**
     * worktree 격리 — 연결 폴더가 git 레포면 별도 worktree(디렉토리+브랜치)를 만들어 그 안에서만
     * 작업한다. 사용자의 현재 작업트리·브랜치가 오염되지 않고, 작업 결과를 `git diff HEAD` 로
     * 정확히 캡처할 수 있다(샌드박스와 달리 인위적 baseline 커밋이 필요 없다 — 레포의 실제
     * HEAD 가 기준점이다). git 레포가 아니거나 생성 실패면 기존 동작으로 폴백(fail-open).
     * 기본 ON — LOCAL_EXECUTOR_ENABLED 자체가 기본 OFF 라 이 값만으로 동작이 바뀌지 않는다.
     */
    WORKTREE_ENABLED: process.env.LOCAL_BRIDGE_WORKTREE !== 'false',
} as const;
