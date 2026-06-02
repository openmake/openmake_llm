/**
 * 채팅 이미지 첨부 모듈.
 *
 * fileInput 선택 → 이미지 검증 → base64(raw) 변환 → attachedFiles state → 입력창 미리보기 칩.
 * 전송은 chat.js 가 attachedFiles.filter(isImage).map(base64) → payload.images 로 처리(이미 구현).
 * 백엔드 external-provider 가 images 를 받아 provider 로 전달하며, vision 미지원 모델은 400 안내.
 *
 * 이미지 전용(png/jpeg/webp/gif), 멀티 첨부. CSP 준수(인라인 onclick 금지 → addEventListener),
 * XSS 안전(파일명 textContent, 썸네일 src 는 자기 파일 data URL).
 *
 * @module modules/file-attach
 */
import { getState, setState } from './state.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

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

async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    const next = [...(getState('attachedFiles') || [])];
    for (const f of files) {
        if (!ALLOWED_TYPES.includes(f.type)) {
            window.showError?.(`이미지 형식만 지원합니다 (png/jpeg/webp/gif): ${f.name}`);
            continue;
        }
        if (f.size > MAX_FILE_BYTES) {
            window.showError?.(`파일이 너무 큽니다 (최대 10MB): ${f.name}`);
            continue;
        }
        try {
            const base64 = await fileToBase64(f);
            // objectUrl: 썸네일용 blob 참조 (매 렌더 base64→data URL 재직렬화/재디코드 회피). 제거 시 revoke.
            next.push({ id: genId(), name: f.name, type: f.type, isImage: true, base64, objectUrl: URL.createObjectURL(f) });
        } catch (e) {
            window.showError?.(`파일을 읽지 못했습니다: ${f.name}`);
        }
    }
    setState('attachedFiles', next);
    renderAttachedPreview();
}

/** attachedFiles → 입력창 위 썸네일 칩 렌더 */
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

        const thumb = document.createElement('img');
        thumb.className = 'attached-chip-thumb';
        thumb.src = f.objectUrl || `data:${f.type};base64,${f.base64}`;
        thumb.alt = f.name;

        const name = document.createElement('span');
        name.className = 'attached-chip-name';
        name.textContent = f.name; // XSS 안전

        const remove = document.createElement('button');
        remove.className = 'attached-chip-remove';
        remove.type = 'button';
        remove.setAttribute('aria-label', `첨부 제거: ${f.name}`);
        remove.textContent = '×';
        remove.addEventListener('click', () => removeAttachedFile(f.id)); // CSP 준수

        chip.append(thumb, name, remove);
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
