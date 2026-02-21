/**
 * ============================================
 * File Upload - 파일 업로드 및 첨부 관리
 * ============================================
 * 파일 업로드 모달, 드래그 앤 드롭, 첨부 파일 목록 관리를 담당합니다.
 * 이미지는 base64 추출(멀티모달), PDF는 텍스트 컨텍스트 추출을 수행합니다.
 *
 * app.js에서 추출됨 (L2906-3215)
 *
 * @module file-upload
 */

import { getState, setState } from './state.js';
import { closeFileModal, showToast, escapeHtml } from './ui.js';
import { updateActiveDocumentUI } from './document.js';

/**
 * 파일을 서버에 업로드하고 첨부 목록에 추가
 * @async
 * @param {File} file - 업로드할 파일 객체
 * @returns {Promise<void>}
 */
async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const uploadArea = document.getElementById('uploadArea');
    const originalContent = uploadArea ? uploadArea.innerHTML : '';
    if (uploadArea) {
        uploadArea.innerHTML = `
            <div class="upload-content">
                <span class="loading-spinner"></span>
                <p>업로드 중: ${escapeHtml(file.name)}</p>
            </div>
        `;
    }

    try {
        // 이미지 파일인 경우 멀티모달 지원을 위해 base64 추출
        let base64 = null;
        if (file.type.startsWith('image/')) {
            base64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(file);
            });
        }

        const res = await fetch('/api/upload', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();

        // Unwrap api-response wrapper
        if (data.data && data.success) { Object.assign(data, data.data); }

        if (data.success) {
            // 멀티모달용 base64 데이터 추가
            if (base64) {
                data.base64 = base64;
                data.isImage = true;
            }

            // PDF 문서인 경우 전체 텍스트를 가져와서 저장
            if (!data.isImage && data.docId) {
                try {
                    const docRes = await fetch(`/api/documents/${data.docId}`);
                    if (!docRes.ok) {
                        throw new Error(`HTTP ${docRes.status}: ${docRes.statusText}`);
                    }
                    const docData = await docRes.json();
                    const docPayload = docData.data || docData;
                    if (docPayload.text) {
                        const maxLength = 20000;
                        if (docPayload.text.length > maxLength) {
                            const front = docPayload.text.substring(0, 15000);
                            const back = docPayload.text.substring(docPayload.text.length - 5000);
                            data.textContent = `${front}\n\n... [중간 내용 ${docPayload.text.length - maxLength}자 생략] ...\n\n${back}`;
                        } else {
                            data.textContent = docPayload.text;
                        }
                        console.log(`[Upload] 문서 텍스트 저장: ${data.textContent.length}자`);
                    }
                } catch (e) {
                    console.warn('[Upload] 문서 텍스트 가져오기 실패:', e);
                    data.textContent = data.preview || '';
                }
            }

            const attachedFiles = getState('attachedFiles') || [];
            attachedFiles.push(data);
            setState('attachedFiles', attachedFiles);
            renderAttachments();

            closeFileModal();

            // PDF 문서인 경우 세션 레벨 컨텍스트 설정
            if (data.docId && !data.isImage) {
                setState('activeDocumentContext', {
                    docId: data.docId,
                    filename: data.filename,
                    textLength: data.textLength || 0
                });
                updateActiveDocumentUI();
                console.log(`[Upload] 활성 문서 설정: ${data.filename} (${data.textLength}자)`);
            }

            showToast(`📄 ${data.filename} 업로드 완료 - 문서 컨텍스트 활성화됨`, 'success');
        } else {
            const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
            alert(errorMsg || '업로드 실패');
        }
    } catch (e) {
        alert('업로드 오류: ' + e.message);
    }

    if (uploadArea) {
        uploadArea.innerHTML = originalContent;
    }
    setupFileInput();
}

/**
 * 파일 입력 요소와 업로드 영역의 이벤트 핸들러 설정
 * @returns {void}
 */
function setupFileInput() {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.onchange = (e) => {
            if (e.target.files.length > 0) {
                uploadFile(e.target.files[0]);
            }
        };
    }

    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) {
        uploadArea.ondragover = (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        };
        uploadArea.ondragleave = () => uploadArea.classList.remove('dragover');
        uploadArea.ondrop = (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                uploadFile(e.dataTransfer.files[0]);
            }
        };
    }
}

/**
 * 채팅 입력 영역의 드래그 앤 드롭 파일 업로드 초기화
 * @returns {void}
 */
function setupChatDropZone() {
    const inputContainer = document.querySelector('.input-container');
    if (!inputContainer) return;
    if (inputContainer._chatDropZoneInit) return;
    inputContainer._chatDropZoneInit = true;

    let dragCounter = 0;

    // 드래그 오버레이 생성
    let overlay = inputContainer.querySelector('.chat-drop-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'chat-drop-overlay';
        overlay.innerHTML = `
            <div class="chat-drop-overlay-content">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p>파일을 여기에 놓으세요</p>
                <span>이미지, PDF, 문서 파일 지원</span>
            </div>
        `;
        inputContainer.style.position = 'relative';
        inputContainer.appendChild(overlay);
    }

    inputContainer.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer.types.includes('Files')) return;
        dragCounter++;
        if (dragCounter === 1) {
            inputContainer.classList.add('chat-drag-active');
        }
    });

    inputContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer.types.includes('Files')) return;
        e.dataTransfer.dropEffect = 'copy';
    });

    inputContainer.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            inputContainer.classList.remove('chat-drag-active');
        }
    });

    inputContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        inputContainer.classList.remove('chat-drag-active');

        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        Array.from(files).forEach((file) => {
            uploadFile(file);
        });
    });

    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', (e) => { e.preventDefault(); });
}

/**
 * 첨부 파일 목록을 DOM에 렌더링
 * @returns {void}
 */
function renderAttachments() {
    const container = document.getElementById('attachments');
    if (!container) return;

    const attachedFiles = getState('attachedFiles') || [];
    if (attachedFiles.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = attachedFiles.map((f, i) => `
        <div class="attachment-item">
            <span>${f.isImage ? '🖼️' : (f.type === 'pdf' ? '📄' : '📝')} ${escapeHtml(f.filename)}</span>
            <button class="attachment-remove" onclick="removeAttachment(${i})">&times;</button>
        </div>
    `).join('');
}

/**
 * 특정 인덱스의 첨부 파일을 제거
 * @param {number} index - 제거할 첨부 파일의 배열 인덱스
 * @returns {void}
 */
function removeAttachment(index) {
    const attachedFiles = getState('attachedFiles') || [];
    attachedFiles.splice(index, 1);
    setState('attachedFiles', attachedFiles);
    renderAttachments();
}

/**
 * 모든 첨부 파일을 제거하고 UI 갱신
 * @returns {void}
 */
function clearAttachments() {
    setState('attachedFiles', []);
    renderAttachments();
}

// 전역 노출 (레거시 호환)
window.uploadFile = uploadFile;
window.setupFileInput = setupFileInput;
window.setupChatDropZone = setupChatDropZone;
window.renderAttachments = renderAttachments;
window.removeAttachment = removeAttachment;
window.clearAttachments = clearAttachments;

export {
    uploadFile,
    setupFileInput,
    setupChatDropZone,
    renderAttachments,
    removeAttachment,
    clearAttachments
};
