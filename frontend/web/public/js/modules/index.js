/**
 * ============================================
 * Module Index - 모듈 로드 순서 정의
 * ============================================
 * 각 모듈의 의존성 관계와 로드 순서를 문서화합니다.
 * 현재 브라우저에서 ES6 모듈을 직접 사용하지 않으므로
 * 각 모듈은 window 객체에 함수들을 전역 노출합니다.
 *
 * @module index
 */

// 현재 브라우저는 ES6 모듈을 직접 사용하지 않으므로
// 각 모듈은 window 객체에 함수들을 노출합니다.

// 모듈 로드 순서 (의존성 순)
// 1. state.js - 상태 관리 (의존성 없음)
// 2. auth.js - 인증 (state에 의존)
// 3. ui.js - UI (state에 의존)
// 4. websocket.js - WebSocket (state에 의존)
// 5. settings.js - 설정 (state, auth, ui에 의존)
// 6. chat.js - 채팅 (state, websocket, ui, auth에 의존)
// 7. guide.js - 가이드 (ui에 의존)
// 8. utils.js - 유틸리티 (의존성 없음)
// 9. main.js - 메인 (모든 모듈에 의존)

// 디버그 로그 - utils.js 로드 후에만 사용 가능
if (typeof debugLog === 'function') {
    debugLog('[Modules] 모듈 인덱스 로드됨');
}
