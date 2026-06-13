/**
 * 채팅 파일 첨부 모듈 (2026-06-12 전체 파일 타입 허용).
 *
 * fileInput 선택 → 타입 분기 → attachedFiles state → 입력창 미리보기 칩.
 * - 이미지(png/jpeg/webp/gif): base64(raw) 변환 → chat.js 가 payload.images 로 전송 (vision 경로, 기존 유지)
 * - 텍스트 파일(UTF-8 디코드 성공): 내용을 textContent 로 보관 → payload.files[].content 로 전송,
 *   백엔드 ws-chat-handler 가 fileContext 로 LLM 에 주입
 * - 바이너리(디코드 실패, pdf/zip 등): 첨부 허용하되 메타(name/type/size)만 전송 + 사용자 경고
 *
 * 멀티 첨부. CSP 준수(인라인 onclick 금지 → addEventListener),
 * XSS 안전(파일명 textContent, 썸네일 src 는 자기 파일 data URL).
 *
 * @module modules/file-attach
 */
import { getState, setState } from './state.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
// 백엔드 FILE_ATTACH_LIMITS 기본값과 동일한 클라이언트 전송 캡 (WS maxPayload 1MB 보호).
// 백엔드 캡은 env 오버라이드 가능 — 여기 값은 전송량 상한이며 절단 시 truncated 플래그로 안내 보장.
const MAX_TEXT_CHARS = 100000;       // FILE_ATTACH_MAX_CHARS_PER_FILE 기본값
const MAX_TOTAL_TEXT_CHARS = 300000; // FILE_ATTACH_MAX_TOTAL_CHARS 기본값
const MAX_ATTACH_FILES = 10;         // FILE_ATTACH_MAX_FILES 기본값

function genId() {
    return 'att-' + Math.random().toString(36).slice(2, 10);
}

/** File → raw base64 (data URL prefix 제거 — stream-parser buildImageDataUrl 이 raw 를 기대) */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = String(reader.result || '');
            const comma = res.indexOf(',');
            resolve(comma >= 0 ? res.slice(comma + 1) : res);
        };
        reader.onerror = () => reject(reader.error || new Error('파일 읽기 실패'));
        reader.readAsDataURL(file);
    });
}

/**
 * File → UTF-8 텍스트 디코드 시도.
 * @returns {Promise<{text: string, truncated: boolean}|null>} 디코드 성공 시 텍스트(캡 적용)와 절단 여부, 바이너리면 null
 */
async function fileToText(file) {
    const buf = await file.arrayBuffer();
    try {
        // fatal: 유효하지 않은 UTF-8 바이트 시퀀스(바이너리)에서 throw
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        const truncated = text.length > MAX_TEXT_CHARS;
        return { text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated };
    } catch {
        return null;
    }
}

async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    const next = [...(getState('attachedFiles') || [])];
    for (const f of files) {
        if (next.length >= MAX_ATTACH_FILES) {
            window.showError?.(`첨부는 최대 ${MAX_ATTACH_FILES}개까지 가능합니다: ${f.name} 제외됨`);
            continue;
        }
        if (f.size > MAX_FILE_BYTES) {
            window.showError?.(`파일이 너무 큽니다 (최대 10MB): ${f.name}`);
            continue;
        }
        try {
            if (IMAGE_TYPES.includes(f.type)) {
                const base64 = await fileToBase64(f);
                // objectUrl: 썸네일용 blob 참조 (매 렌더 base64→data URL 재직렬화/재디코드 회피). 제거 시 revoke.
                next.push({ id: genId(), name: f.name, type: f.type, size: f.size, isImage: true, base64, objectUrl: URL.createObjectURL(f) });
            } else {
                const decoded = await fileToText(f);
                if (decoded === null) {
                    // 바이너리 — 첨부는 허용, 메타만 전달됨을 안내
                    window.showError?.(`${f.name}: 내용을 읽을 수 없는 형식이라 파일명/형식만 AI에 전달됩니다`);
                    next.push({ id: genId(), name: f.name, type: f.type || 'application/octet-stream', size: f.size, isImage: false });
                    continue;
                }
                // 합산 전송량 캡 — WS maxPayload(1MB) 초과로 소켓이 끊기는 것을 첨부 시점에 차단
                let { text, truncated } = decoded;
                const used = next.reduce((sum, x) => sum + (x.textContent ? x.textContent.length : 0), 0);
                const remaining = MAX_TOTAL_TEXT_CHARS - used;
                if (remaining <= 0) {
                    window.showError?.(`첨부 텍스트 합산 한도(${MAX_TOTAL_TEXT_CHARS.toLocaleString()}자) 초과: ${f.name} 제외됨`);
                    continue;
                }
                if (text.length > remaining) {
                    text = text.slice(0, remaining);
                    truncated = true;
                }
                if (truncated) {
                    window.showError?.(`${f.name}: 파일이 길어 앞부분만 AI에 전달됩니다`);
                }
                next.push({ id: genId(), name: f.name, type: f.type || 'application/octet-stream', size: f.size, isImage: false, textContent: text, textTruncated: truncated });
            }
        } catch {
            window.showError?.(`파일을 읽지 못했습니다: ${f.name}`);
        }
    }
    setState('attachedFiles', next);
    renderAttachedPreview();
}

/** 파일명 → 확장자 배지 텍스트 (없으면 'FILE') */
function fileExtBadge(name) {
    const dot = String(name || '').lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
    return ext && ext.length <= 5 ? ext : 'FILE';
}

/** attachedFiles → 입력창 위 미리보기 칩 렌더 (이미지: 썸네일, 그 외: 확장자 배지) */
export function renderAttachedPreview() {
    const box = document.getElementById('attachments');
    if (!box) return;
    const files = getState('attachedFiles') || [];
    box.replaceChildren();
    if (files.length === 0) {
        box.style.display = 'none';
        return;
    }
    box.style.display = 'flex';
    for (const f of files) {
        const chip = document.createElement('div');
        chip.className = 'attached-chip';

        if (f.isImage) {
            const thumb = document.createElement('img');
            thumb.className = 'attached-chip-thumb';
            thumb.src = f.objectUrl || `data:${f.type};base64,${f.base64}`;
            thumb.alt = f.name;
            chip.appendChild(thumb);
        } else {
            const badge = document.createElement('span');
            badge.className = 'attached-chip-filebadge';
            badge.textContent = fileExtBadge(f.name); // XSS 안전
            chip.appendChild(badge);
        }

        const name = document.createElement('span');
        name.className = 'attached-chip-name';
        name.textContent = f.name; // XSS 안전

        const remove = document.createElement('button');
        remove.className = 'attached-chip-remove';
        remove.type = 'button';
        remove.setAttribute('aria-label', `첨부 제거: ${f.name}`);
        remove.textContent = '×';
        remove.addEventListener('click', () => removeAttachedFile(f.id)); // CSP 준수

        chip.append(name, remove);
        box.appendChild(chip);
    }
}

export function removeAttachedFile(id) {
    const files = getState('attachedFiles') || [];
    const target = files.find((f) => f.id === id);
    if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl); // blob 참조 해제
    setState('attachedFiles', files.filter((f) => f.id !== id));
    renderAttachedPreview();
}

export function clearAttachedFiles() {
    (getState('attachedFiles') || []).forEach((f) => { if (f.objectUrl) URL.revokeObjectURL(f.objectUrl); });
    setState('attachedFiles', []);
    renderAttachedPreview();
}

export function initFileAttach() {
    const fi = document.getElementById('fileInput');
    if (!fi || fi.dataset.bound === '1') return;
    fi.dataset.bound = '1';
    fi.addEventListener('change', async (e) => {
        await handleFiles(e.target.files);
        e.target.value = ''; // 같은 파일 재선택 허용
        window.closeFileModal?.(); // 선택 후 모달 닫기
    });
    renderAttachedPreview();
}

// self-init
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFileAttach);
    } else {
        initFileAttach();
    }
}
// chat.js(window 전역)에서 전송 후 클리어용
if (typeof window !== 'undefined') {
    window.clearAttachedFiles = clearAttachedFiles;
}
