/**
 * ============================================================
 * System Toast Module - SystemEvent 알림 토스트
 * ============================================================
 *
 * 백엔드의 onSystemEvent 콜백에서 발행된 SystemEvent를
 * 화면 우측 상단 토스트로 표시한다.
 *
 * 백엔드 메시지 형식 (WebSocket):
 *   { type: 'system_event', payload: { type, message, metadata? } }
 *
 * SystemEvent 타입 (backend/api/src/services/chat-service-types.ts):
 *   interface SystemEvent {
 *     type: 'info' | 'warning' | 'success' | string;
 *     message: string;       // 다국어 처리 완료 평문
 *     metadata?: Record<string, unknown>;
 *   }
 *
 * 사용:
 *   import { showSystemToast } from './system-toast.js';
 *   showSystemToast({ type: 'info', message: '시스템 알림 메시지' });
 *
 * 또는 전역 노출본:
 *   window.showSystemToast(event)
 *
 * ============================================================
 * 수동 테스트 가이드
 * ============================================================
 * 1. 채팅 페이지(/) 로드 후 브라우저 DevTools 콘솔에서:
 *      window.showSystemToast({
 *        type: 'info',
 *        message: '시스템 알림 메시지'
 *      })
 *    → 우측 상단에 토스트가 나타나고 5초 후 사라져야 함.
 *
 * 2. 다중 토스트 스택 테스트 (4개 연속 호출 → 가장 오래된 1개 즉시 제거):
 *      for (let i = 1; i <= 4; i++) {
 *        window.showSystemToast({ type: 'info', message: '토스트 #' + i });
 *      }
 *    → 동시 표시는 최대 3개여야 함 (#1 즉시 제거, #2~#4 표시).
 *
 * 3. XSS 방어 검증 (스크립트 삽입 시도 → 평문으로만 표시):
 *      window.showSystemToast({
 *        type: 'info',
 *        message: '<img src=x onerror=alert(1)><script>alert(2)</script>'
 *      })
 *    → 알림창이 뜨지 않고 텍스트 그대로 표시되어야 함.
 *
 * 4. 모바일 반응형: DevTools에서 viewport를 360px 너비로 변경 → 토스트가
 *    좌우 8px 여백을 두고 거의 full-width 로 표시되어야 함.
 *
 * 5. 접근성: 시스템 설정에서 "동작 줄이기" 활성화 (macOS: 시스템 설정 →
 *    손쉬운 사용 → 디스플레이) 후 토스트 호출 → 슬라이드 애니메이션 없이
 *    즉시 표시되어야 함. 스크린 리더(VoiceOver/NVDA) 켠 상태에서
 *    role="status" + aria-live="polite" 가 메시지를 읽어야 함.
 *
 * 6. End-to-End: 채팅 페이지에서 자동 토론을 트리거하는 복합 질문 입력
 *    (예: "AI의 윤리적 영향을 다양한 관점에서 토론해줘") → 응답 직전
 *    토스트로 "자동 토론 모드 활성화" 안내가 떠야 함.
 *
 * @module system-toast
 */

import { debugLog } from './utils.js';

/** 단일 토스트 컨테이너 ID */
const CONTAINER_ID = 'system-toast-container';
/** 최대 동시 표시 개수 */
const MAX_TOASTS = 3;
/** 자동 dismiss 시간 (ms) */
const AUTO_DISMISS_MS = 5000;
/** 페이드아웃 애니메이션 시간 (ms) — CSS와 일치해야 함 */
const LEAVE_ANIM_MS = 180;

/** event.type → 좌측 아이콘 이모지 (선택적 시각 단서) */
const TYPE_ICONS = {
    'info': '\u{2139}\u{FE0F}',                // ℹ️
    'warning': '\u{26A0}\u{FE0F}',             // ⚠️
    'success': '\u{2705}',                     // ✅
};

/** event.type → CSS variant 클래스 매핑 */
const TYPE_CLASS_MAP = {
    'info': 'system-toast--info',
    'warning': 'system-toast--warning',
    'success': 'system-toast--success',
};

/**
 * 활성 토스트 메타 추적 (FIFO 큐)
 * 각 항목: { element: HTMLElement, timerId: number }
 * @type {Array<{element: HTMLElement, timerId: ReturnType<typeof setTimeout>}>}
 */
const activeToasts = [];

/**
 * 토스트 컨테이너 DOM 확보 (없으면 생성)
 * 컨테이너는 페이지 라이프사이클 동안 단일 인스턴스로 유지된다.
 * @returns {HTMLElement} 토스트 컨테이너 요소
 */
function ensureContainer() {
    let container = document.getElementById(CONTAINER_ID);
    if (container) return container;

    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'system-toast-container';
    // 접근성:
    //   role="status" — 비긴급 상태 변경 알림 (alert는 긴급 에러용)
    //   aria-live="polite" — 사용자 작업을 가로채지 않고 다음 휴지기에 읽음
    //   aria-atomic="true" — 변경 시 전체 메시지를 읽음
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
    return container;
}

/**
 * 토스트를 DOM에서 제거하고 큐에서 정리
 * 페이드아웃 애니메이션 후 실제 제거. 중복 호출 안전.
 * @param {HTMLElement} element - 제거할 토스트 요소
 * @param {boolean} animate - 페이드아웃 애니메이션 여부 (false면 즉시 제거)
 */
function removeToast(element, animate = true) {
    if (!element || !element.isConnected) {
        // 이미 제거됨 → 큐에서만 정리
        const idx = activeToasts.findIndex(t => t.element === element);
        if (idx !== -1) {
            clearTimeout(activeToasts[idx].timerId);
            activeToasts.splice(idx, 1);
        }
        return;
    }

    const idx = activeToasts.findIndex(t => t.element === element);
    if (idx !== -1) {
        clearTimeout(activeToasts[idx].timerId);
        activeToasts.splice(idx, 1);
    }

    if (!animate) {
        element.remove();
        return;
    }

    element.classList.add('system-toast--leaving');
    setTimeout(() => {
        if (element.isConnected) element.remove();
    }, LEAVE_ANIM_MS);
}

/**
 * SystemEvent를 받아 우측 상단 토스트를 표시
 *
 * XSS 방어:
 *   - event.message 는 element.textContent 로만 설정 (innerHTML 사용 금지)
 *   - DOMPurify 거치지 않는 이유: SystemEvent.message 는 서버에서 다국어 처리된
 *     평문으로, HTML 의도가 없음. textContent 가 sanitizer 보다 더 엄격하게
 *     모든 마크업/스크립트를 비활성화한다.
 *   - event.type 은 화이트리스트(TYPE_CLASS_MAP) 매칭만 수용, 매칭 실패 시
 *     'info' 변형으로 폴백 (임의 클래스 주입 차단).
 *
 * 다중 토스트 정책 (FIFO, MAX_TOASTS=3):
 *   - 활성 토스트가 3개에 도달한 상태에서 4번째 호출 시
 *     가장 오래된 토스트를 즉시 제거(애니메이션 없이) 후 신규 추가.
 *   - 5초 후 자동 dismiss (페이드아웃 애니메이션 적용).
 *   - 사용자가 닫기 버튼(×) 클릭 시 즉시 제거.
 *
 * @param {{type: string, message: string, metadata?: Record<string, unknown>}} event
 *   SystemEvent 객체 (백엔드 chat-service-types.ts 와 동일 구조)
 * @returns {HTMLElement|null} 생성된 토스트 요소, 잘못된 입력이면 null
 */
function showSystemToast(event) {
    if (!event || typeof event !== 'object') {
        debugLog('[SystemToast] 잘못된 이벤트 무시:', event);
        return null;
    }
    const messageText = (typeof event.message === 'string' && event.message.trim())
        ? event.message
        : '';
    if (!messageText) {
        debugLog('[SystemToast] 메시지 없음 — 표시 생략');
        return null;
    }

    // type 화이트리스트 매칭 — 임의 문자열은 'info' 폴백
    const eventType = (typeof event.type === 'string') ? event.type : 'info';
    const variantClass = TYPE_CLASS_MAP[eventType] || TYPE_CLASS_MAP['info'];
    const iconChar = TYPE_ICONS[eventType] || TYPE_ICONS['info'];

    const container = ensureContainer();

    // FIFO 초과분 즉시 제거 (애니메이션 생략 — 새 토스트 슬라이드인과 동시 발생 방지)
    while (activeToasts.length >= MAX_TOASTS) {
        const oldest = activeToasts[0];
        removeToast(oldest.element, false);
    }

    // 토스트 DOM 구축 — 모든 텍스트는 textContent (XSS 방어)
    const toast = document.createElement('div');
    toast.className = `system-toast ${variantClass}`;
    toast.dataset.eventType = eventType;

    const iconEl = document.createElement('span');
    iconEl.className = 'system-toast-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = iconChar;

    const messageEl = document.createElement('span');
    messageEl.className = 'system-toast-message';
    // ★ XSS 방어 핵심: textContent 만 사용 (innerHTML 금지)
    messageEl.textContent = messageText;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'system-toast-close';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.textContent = '\u00D7'; // ×
    closeBtn.addEventListener('click', () => removeToast(toast, true));

    toast.appendChild(iconEl);
    toast.appendChild(messageEl);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    // 자동 dismiss 타이머
    const timerId = setTimeout(() => removeToast(toast, true), AUTO_DISMISS_MS);
    activeToasts.push({ element: toast, timerId });

    debugLog('[SystemToast] 표시:', eventType, messageText);
    return toast;
}

/**
 * (테스트/정리용) 모든 활성 토스트를 즉시 제거
 * 페이지 전환 시 등에서 호출.
 */
function clearAllSystemToasts() {
    // activeToasts 가 removeToast 내부에서 변형되므로 복사본으로 반복
    const snapshot = [...activeToasts];
    for (const { element } of snapshot) {
        removeToast(element, false);
    }
}

// 전역 노출 — 비-모듈 스크립트 및 DevTools 수동 테스트용
window.showSystemToast = showSystemToast;
window.clearAllSystemToasts = clearAllSystemToasts;

export { showSystemToast, clearAllSystemToasts };
