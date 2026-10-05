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

    /**
     * 유저당 동시 등록 PC 상한. PC 는 bridge_hello.hostId 로 구분한다 — 같은 PC 의 폴더별 연결은 1대로 센다.
     * hostId 를 보내지 않는 구버전 기기는 연결(deviceId)마다 1대로 센다.
     */
    MAX_DEVICES: parseInt(process.env.LOCAL_BRIDGE_MAX_DEVICES || '3', 10),

    /** PC 1대가 동시에 연결할 수 있는 폴더(루트) 상한 — PC 단위로 세면서 폴더 수가 무한정 늘지 않게 한다. */
    MAX_ROOTS_PER_HOST: parseInt(process.env.LOCAL_BRIDGE_MAX_ROOTS_PER_HOST || '8', 10),

    /** 폴더 선택(folders kind) 1회 열거 상한 — 초과분은 절단 + truncated 플래그(디바이스측 강제). */
    FOLDERS_MAX_ENTRIES: parseInt(process.env.BRIDGE_FOLDERS_MAX_ENTRIES || '200', 10),

    /**
     * 로컬 브라우저(Companion P2) — 로컬 실행 작업이 사용자 PC 의 전용 프로필 Chrome 을 쓰게 한다. 기본 OFF.
     * 켜도 기기가 능력 목록에 browser 를 알렸을 때만 도구가 노출된다. 사이트 정책(BROWSER_SITE_POLICY)이 함께 적용된다.
     */
    BROWSER_ENABLED: process.env.LOCAL_BRIDGE_BROWSER_ENABLED === 'true',

    /** 브라우저 요청 1회 응답 대기 상한(ms) — 액션 여러 개를 한 번에 실행한다. LOCAL_BRIDGE_BROWSER_TIMEOUT_MS(기본 5분) */
    BROWSER_TIMEOUT_MS: parseInt(process.env.LOCAL_BRIDGE_BROWSER_TIMEOUT_MS || '', 10) || 5 * 60 * 1000,

    /**
     * 기기 대기 — 로컬 실행 작업이 쓸 기기가 연결돼 있지 않으면 실패시키지 않고 멈춰 두었다가(paused + device_wait),
     * 기기가 다시 연결되면 이어서 실행한다. 기본 ON — LOCAL_EXECUTOR_ENABLED 자체가 기본 OFF 라 이 값만으로 동작이 바뀌지 않는다.
     */
    DEVICE_WAIT_ENABLED: process.env.LOCAL_BRIDGE_DEVICE_WAIT !== 'false',

    /** 기기 대기 상한(ms) — 넘기면 작업을 실패(device_wait_expired)로 끝낸다. LOCAL_BRIDGE_DEVICE_WAIT_MAX_MS(기본 24시간) */
    DEVICE_WAIT_MAX_MS: parseInt(process.env.LOCAL_BRIDGE_DEVICE_WAIT_MAX_MS || '', 10) || 24 * 60 * 60 * 1000,

    /**
     * 브라우저 넘겨받기 주차(2026-10-05) — 사용자가 Companion 에서 브라우저를 넘겨받아 기기가 요청을 거절하면, 도구 오류로
     * 모델에 돌려주지 않고 작업을 멈춰 실행 자리를 반납한다(paused + browser_takeover). 돌려주면 이어서 실행한다.
     * 기본 OFF — LOCAL_BRIDGE_TAKEOVER_PARK=true 로 켠다. 끄면 종전대로 거절 문구가 도구 결과로 모델에 간다.
     */
    TAKEOVER_PARK_ENABLED: process.env.LOCAL_BRIDGE_TAKEOVER_PARK === 'true',

    /** 넘겨받기 대기 상한(ms) — 넘기면 작업을 실패(browser_takeover_expired)로 끝낸다. LOCAL_BRIDGE_TAKEOVER_WAIT_MAX_MS(기본 1시간) */
    TAKEOVER_WAIT_MAX_MS: parseInt(process.env.LOCAL_BRIDGE_TAKEOVER_WAIT_MAX_MS || '', 10) || 60 * 60 * 1000,

    /**
     * worktree 격리 — 연결 폴더가 git 레포면 별도 worktree(디렉토리+브랜치)를 만들어 그 안에서만
     * 작업한다. 사용자의 현재 작업트리·브랜치가 오염되지 않고, 작업 결과를 `git diff HEAD` 로
     * 정확히 캡처할 수 있다(샌드박스와 달리 인위적 baseline 커밋이 필요 없다 — 레포의 실제
     * HEAD 가 기준점이다). git 레포가 아니거나 생성 실패면 기존 동작으로 폴백(fail-open).
     * 기본 ON — LOCAL_EXECUTOR_ENABLED 자체가 기본 OFF 라 이 값만으로 동작이 바뀌지 않는다.
     */
    WORKTREE_ENABLED: process.env.LOCAL_BRIDGE_WORKTREE !== 'false',

    /**
     * 편집 후 진단(LSP diagnostics-first) — 파일 쓰기 도구가 성공한 직후 디바이스에서 컴파일러
     * 진단을 받아 도구 결과에 덧붙인다. 모델에 새 도구를 노출하지 않으므로 도구폭주 축과 무관하고,
     * 실패·타임아웃·미지원 디바이스는 조용히 생략(fail-open)한다.
     * 기본 OFF — 셰도우 측정(tool-errors·workflow 지표) 후 켠다.
     */
    LSP_ENABLED: process.env.LOCAL_BRIDGE_LSP_ENABLED === 'true',

    /** 진단 1회 대기 상한(ms) — 초과 시 생략. 디바이스측 DIAG_TIMEOUT_MS 보다 짧게 잡는다. */
    LSP_TIMEOUT_MS: parseInt(process.env.LOCAL_BRIDGE_LSP_TIMEOUT_MS || '10000', 10),
} as const;
