/**
 * Utils Module
 * 공통 유틸리티 함수들을 제공합니다.
 */

// 디버그 모드 플래그 (프로덕션에서는 false로 설정)
const DEBUG = window.DEBUG_MODE ?? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

/**
 * 조건부 디버그 로깅
 * DEBUG가 true일 때만 console.log 출력
 * @param  {...any} args - 로그 인자들
 */
function debugLog(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

/**
 * 조건부 디버그 경고
 * @param  {...any} args - 로그 인자들
 */
function debugWarn(...args) {
    if (DEBUG) {
        console.warn(...args);
    }
}

/**
 * 조건부 디버그 에러 (에러는 프로덕션에서도 출력)
 * @param  {...any} args - 로그 인자들
 */
function debugError(...args) {
    console.error(...args);
}

/**
 * 파일명 자르기
 * @param {string} filename - 파일명
 * @param {number} maxLength - 최대 길이
 */
function truncateFilename(filename, maxLength) {
    if (!filename || filename.length <= maxLength) return filename;
    const ext = filename.split('.').pop();
    const name = filename.slice(0, -(ext.length + 1));
    const truncatedName = name.slice(0, maxLength - ext.length - 4) + '...';
    return truncatedName + '.' + ext;
}

/**
 * 파일 크기 포맷
 * @param {number} bytes - 바이트
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 날짜 포맷
 * @param {Date|string} date - 날짜
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
 * 상대적 시간 표시
 * @param {Date|string} date - 날짜
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
 * 디바운스
 * @param {Function} func - 함수
 * @param {number} wait - 대기 시간 (ms)
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
 * 쓰로틀
 * @param {Function} func - 함수
 * @param {number} limit - 제한 시간 (ms)
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
 * UUID 생성
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 딥 클론
 * @param {*} obj - 객체
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * 키보드 이벤트 핸들러
 * @param {KeyboardEvent} event - 키보드 이벤트
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
 * 명령어 처리
 * @param {string} command - 명령어
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
