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
     * 로컬 브라우저(D3a) — 데스크톱 Electron 내장 Chromium 에서 browser 도구를 실행한다.
     * 서버 컨테이너 브라우저와 달리 **사용자 화면에 보이는** 패널로 뜨고, 전용 세션 파티션이라
     * 개인 Chrome 쿠키·로그인에 접근하지 않는다. 기본 OFF — 켤 때 위 ENABLED 도 함께 필요.
     */
    BROWSER_ENABLED: process.env.LOCAL_BRIDGE_BROWSER_ENABLED === 'true',

    /** 브라우저 액션 배열 1회 실행 상한(ms). 컨테이너 runner 기본값과 같은 축. */
    BROWSER_TIMEOUT_MS: parseInt(process.env.LOCAL_BRIDGE_BROWSER_TIMEOUT_MS || '60000', 10),
} as const;
