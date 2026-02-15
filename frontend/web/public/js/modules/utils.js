/**
 * ============================================
 * Utils Module - 공통 유틸리티 함수 모음
 * ============================================
 * 디버그 로깅, 파일명/크기/날짜 포맷팅, 디바운스/쓰로틀,
 * UUID 생성, 키보드 이벤트 핸들링, 슬래시 명령어 처리 등
 * 애플리케이션 전반에서 사용되는 헬퍼 함수를 제공합니다.
 *
 * @module utils
 */

/**
 * 디버그 모드 플래그
 * localhost/127.0.0.1에서는 자동 활성화, 프로덕션에서는 비활성화됩니다.
 * window.DEBUG_MODE로 수동 오버라이드 가능합니다.
 * @type {boolean}
 */
const DEBUG = window.DEBUG_MODE ?? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

/**
 * 조건부 디버그 로깅
 * DEBUG 플래그가 true일 때만 console.log를 출력합니다.
 * @param {...*} args - 콘솔에 출력할 인자들
 * @returns {void}
 */
function debugLog(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

/**
 * 조건부 디버그 경고
 * DEBUG 플래그가 true일 때만 console.warn을 출력합니다.
 * @param {...*} args - 콘솔에 출력할 인자들
 * @returns {void}
 */
function debugWarn(...args) {
    if (DEBUG) {
        console.warn(...args);
    }
}

/**
 * 에러 로깅 (프로덕션에서도 항상 출력)
 * 에러는 DEBUG 플래그와 무관하게 항상 console.error로 출력합니다.
 * @param {...*} args - 콘솔에 출력할 인자들
 * @returns {void}
 */
function debugError(...args) {
    console.error(...args);
}

/**
 * 파일명을 최대 길이로 자르기
 * 확장자는 보존하고 파일명 부분만 잘라서 '...'을 추가합니다.
 * @param {string} filename - 원본 파일명
 * @param {number} maxLength - 결과 문자열의 최대 길이
 * @returns {string} 잘린 파일명 또는 원본 (maxLength 이하인 경우)
 */
function truncateFilename(filename, maxLength) {
    if (!filename || filename.length <= maxLength) return filename;
    const ext = filename.split('.').pop();
    const name = filename.slice(0, -(ext.length + 1));
    const truncatedName = name.slice(0, maxLength - ext.length - 4) + '...';
    return truncatedName + '.' + ext;
}

/**
 * 바이트 수를 사람이 읽을 수 있는 파일 크기로 변환
 * @param {number} bytes - 바이트 크기
 * @returns {string} 포맷된 파일 크기 (예: '1.5 MB')
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 날짜를 한국어 로케일 형식으로 포맷
 * @param {Date|string} date - Date 객체 또는 ISO 문자열
 * @returns {string} 포맷된 날짜 문자열 (예: '2026년 2월 15일 오후 3:30')
 */
function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * 상대적 시간 표시 (예: '방금 전', '5분 전', '3일 전')
 * 7일 초과 시 formatDate로 폴백합니다.
 * @param {Date|string} date - Date 객체 또는 ISO 문자열
 * @returns {string} 상대적 시간 문자열
 */
function relativeTime(date) {
    const now = new Date();
    const d = new Date(date);
    const diff = now - d;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;

    return formatDate(date);
}

/**
 * 디바운스 - 마지막 호출 후 대기 시간이 지나야 실행
 * 연속 호출 시 이전 타이머를 취소하고 새로 시작합니다.
 * @param {Function} func - 실행할 함수
 * @param {number} wait - 대기 시간 (밀리초)
 * @returns {Function} 디바운스 적용된 래퍼 함수
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 쓰로틀 - 지정된 간격 내 최대 1회만 실행
 * 제한 시간 동안 추가 호출을 무시합니다.
 * @param {Function} func - 실행할 함수
 * @param {number} limit - 최소 실행 간격 (밀리초)
 * @returns {Function} 쓰로틀 적용된 래퍼 함수
 */
function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * UUID v4 형식의 고유 식별자 생성
 * Math.random 기반의 간이 구현입니다.
 * @returns {string} UUID 문자열 (예: 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5')
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * JSON 기반 딥 클론
 * 함수, undefined, Symbol 등은 복사되지 않습니다.
 * @param {*} obj - 복사할 객체
 * @returns {*} 깊은 복사된 새 객체
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * 전역 키보드 이벤트 핸들러
 * Enter: 메시지 전송 (Shift+Enter는 줄바꿈), IME 조합 중 무시
 * ESC: 활성 모달 닫기
 * 슬래시(/)로 시작하는 입력은 명령어로 처리합니다.
 * @param {KeyboardEvent} event - 키보드 이벤트 객체
 * @returns {void}
 */
function handleKeyDown(event) {
    const input = document.getElementById('chatInput');
    const value = input?.value?.trim() || '';

    // IME 조합 중인 경우 (한글 등 입력 중) Enter 무시
    if (event.isComposing || event.keyCode === 229) {
        return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();

        // 빈 메시지 무시
        if (!value && (!window.getState || window.getState('attachedFiles')?.length === 0)) {
            return;
        }

        // 명령어 체크
        if (value.startsWith('/')) {
            if (typeof handleCommand === 'function' && handleCommand(value)) {
                input.value = '';
                return;
            }
        }

        if (typeof sendMessage === 'function') {
            sendMessage();
        }
    }

    // ESC로 모달 닫기
    if (event.key === 'Escape') {
        const activeModals = document.querySelectorAll('.modal.active');
        activeModals.forEach(modal => {
            modal.classList.remove('active');
        });
    }
}

/**
 * 슬래시 명령어 처리
 * /help: 사용자 가이드 표시, /clear: 새 대화 시작, /mode [name]: 프롬프트 모드 변경
 * @param {string} command - 슬래시로 시작하는 명령어 문자열
 * @returns {boolean} 명령어가 처리되었으면 true, 미인식 명령어는 false
 */
function handleCommand(command) {
    const cmd = command.toLowerCase().trim();

    if (cmd === '/help') {
        if (typeof showUserGuide === 'function') {
            showUserGuide();
        }
        return true;
    }

    if (cmd === '/clear') {
        if (typeof newChat === 'function') {
            newChat();
        }
        return true;
    }

    if (cmd.startsWith('/mode ')) {
        const mode = cmd.replace('/mode ', '').trim();
        if (typeof setPromptMode === 'function') {
            setPromptMode(mode);
            if (typeof showToast === 'function') {
                showToast(`프롬프트 모드: ${mode}`);
            }
        }
        return true;
    }

    return false;
}

// 전역 노출
window.truncateFilename = truncateFilename;
window.formatFileSize = formatFileSize;
window.formatDate = formatDate;
window.relativeTime = relativeTime;
window.debounce = debounce;
window.throttle = throttle;
window.generateUUID = generateUUID;
window.deepClone = deepClone;
window.handleKeyDown = handleKeyDown;
window.handleCommand = handleCommand;
window.debugLog = debugLog;
window.debugWarn = debugWarn;
window.debugError = debugError;
window.DEBUG = DEBUG;

export {
    truncateFilename,
    formatFileSize,
    formatDate,
    relativeTime,
    debounce,
    throttle,
    generateUUID,
    deepClone,
    handleKeyDown,
    handleCommand,
    debugLog,
    debugWarn,
    debugError,
    DEBUG
};
