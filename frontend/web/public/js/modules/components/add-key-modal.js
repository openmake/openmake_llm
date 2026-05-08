/**
 * Add Key Modal — 외부 LLM provider 키 등록 모달.
 * AddKeyModal.open({ providerId, onSuccess }) 호출 시 렌더.
 *
 * @module components/add-key-modal
 */
'use strict';

let _modal = null;
let _currentProvider = null;
let _onSuccess = null;
let _clickHandler = null;

function escAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

async function authFetch(url, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return (window.authFetch || fetch)(url, opts);
}

function ensure() {
    if (_modal) return _modal;
    _modal = document.createElement('div');
    // 본 프로젝트 modal 시스템 호환 — components.css의 .modal-overlay.active 패턴 따름
    _modal.className = 'modal-overlay';
    _modal.id = 'addKeyModalOverlay';
    document.body.appendChild(_modal);
    return _modal;
}

export function close() {
    if (_modal) _modal.classList.remove('active');
    if (_clickHandler && _modal) {
        _modal.removeEventListener('click', _clickHandler);
        _clickHandler = null;
    }
    _currentProvider = null;
    _onSuccess = null;
}

function render(provider) {
    const isOpenAICompat = provider.sdk_type === 'openai-compatible';
    const supportsOAuth = (provider.auth_methods || ['api_key']).includes('oauth');

    _modal.innerHTML =
        '<div class="modal" style="max-width:480px;background:var(--bg-card);border-radius:var(--radius-lg);padding:0;box-shadow:var(--shadow-lg)">' +
        '<div class="modal-header" style="padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center">' +
        '<h3 style="margin:0;font-size:var(--font-size-lg)">' + escText(provider.display_name) + ' 키 등록</h3>' +
        '<button data-action="close" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted)">&times;</button>' +
        '</div>' +
        '<div class="modal-body" style="padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3)">' +
        (supportsOAuth
            ? '<div style="font-size:var(--font-size-sm)">인증 방식:<br>' +
              '<label style="margin-right:12px"><input type="radio" name="authMethod" value="api_key" checked> API Key 직접 입력</label>' +
              '<label style="color:var(--text-muted)"><input type="radio" name="authMethod" value="oauth" disabled> OAuth (Phase 2 예정)</label>' +
              '</div>'
            : '') +
        '<label style="font-size:var(--font-size-sm);color:var(--text-secondary)">표시 이름' +
        '<input type="text" id="ek-name" value="' + escAttr(provider.display_name) +
        '" style="width:100%;padding:var(--space-2) var(--space-3);background:var(--bg-tertiary);border:1px solid var(--border-light);border-radius:var(--radius-md);color:var(--text-primary);box-sizing:border-box;margin-top:4px" /></label>' +
        (isOpenAICompat
            ? '<label style="font-size:var(--font-size-sm);color:var(--text-secondary)">Base URL' +
              '<input type="text" id="ek-baseurl" value="' + escAttr(provider.default_base_url) +
              '" style="width:100%;padding:var(--space-2) var(--space-3);background:var(--bg-tertiary);border:1px solid var(--border-light);border-radius:var(--radius-md);color:var(--text-primary);box-sizing:border-box;margin-top:4px" /></label>'
            : '') +
        '<label style="font-size:var(--font-size-sm);color:var(--text-secondary)">API Key' +
        '<input type="password" id="ek-key" placeholder="' + escAttr(provider.key_prefix_pattern || '키 입력') +
        '" autocomplete="off" style="width:100%;padding:var(--space-2) var(--space-3);background:var(--bg-tertiary);border:1px solid var(--border-light);border-radius:var(--radius-md);color:var(--text-primary);box-sizing:border-box;margin-top:4px;font-family:monospace" /></label>' +
        '<div style="font-size:11px;color:var(--text-muted)">' + escText(provider.help_text || '') + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted)">※ 사용량은 본 서비스가 아닌 ' + escText(provider.display_name) + ' 계정으로 청구됩니다.</div>' +
        '</div>' +
        '<div class="modal-footer" style="padding:var(--space-4) var(--space-5);border-top:1px solid var(--border-light);display:flex;justify-content:flex-end;gap:var(--space-2)">' +
        '<button data-action="close" style="padding:var(--space-2) var(--space-4);background:var(--bg-tertiary);border:1px solid var(--border-light);border-radius:var(--radius-md);cursor:pointer;color:var(--text-primary)">취소</button>' +
        '<button data-action="save" style="padding:var(--space-2) var(--space-4);background:var(--accent-primary);border:none;border-radius:var(--radius-md);cursor:pointer;color:#fff;font-weight:var(--font-weight-semibold)">등록</button>' +
        '</div>' +
        '</div>';

    _modal.classList.add('active');

    _clickHandler = function (ev) {
        const action = ev.target.closest('[data-action]');
        if (!action) {
            if (ev.target === _modal) close();
            return;
        }
        if (action.dataset.action === 'close') close();
        else if (action.dataset.action === 'save') save();
    };
    _modal.addEventListener('click', _clickHandler);
}

async function save() {
    const provider = _currentProvider;
    if (!provider) return;
    const apiKey = document.getElementById('ek-key').value.trim();
    if (!apiKey) {
        if (window.showToast) window.showToast('API 키를 입력하세요', 'error');
        return;
    }
    const name = document.getElementById('ek-name').value.trim() || provider.display_name;
    const baseUrlEl = document.getElementById('ek-baseurl');
    const baseUrl = baseUrlEl ? baseUrlEl.value.trim() : null;

    try {
        const res = await authFetch('/api/external-keys/' + encodeURIComponent(provider.provider_id), {
            method: 'POST',
            body: JSON.stringify({
                sdk_type: provider.sdk_type,
                display_name: name,
                base_url: baseUrl || null,
                api_key: apiKey,
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || err.message || '저장 실패');
        }
        if (window.showToast) window.showToast(provider.display_name + ' 등록 완료');
        const cb = _onSuccess;
        close();
        if (typeof cb === 'function') await cb();
    } catch (e) {
        if (window.showToast) window.showToast(e.message || '저장 실패', 'error');
    }
}

function logDbg(msg) {
    try {
        const panel = document.getElementById('ms-debug-panel');
        if (panel) {
            const line = document.createElement('div');
            line.textContent = '[' + new Date().toLocaleTimeString() + '] [AddKeyModal] ' + msg;
            panel.appendChild(line);
            panel.scrollTop = panel.scrollHeight;
        }
    } catch (_) {}
    try { console.info('[AddKeyModal]', msg); } catch (_) {}
}

export async function open(opts) {
    ensure();
    logDbg('open(' + opts.providerId + ') 시작');
    _currentProvider = null;
    _onSuccess = opts.onSuccess || null;
    const res = await authFetch('/api/external-keys');
    if (!res.ok) {
        logDbg('  ✗ /api/external-keys ' + res.status + ' — 로그인 필요');
        if (window.showToast) window.showToast('카탈로그 로드 실패 (로그인 필요)', 'error');
        return;
    }
    const json = await res.json();
    const providers = (json.data && json.data.providers) || [];
    _currentProvider = providers.find(p => p.provider_id === opts.providerId);
    if (!_currentProvider) {
        logDbg('  ✗ providers 에 ' + opts.providerId + ' 미발견 (' + providers.length + ' 개)');
        if (window.showToast) window.showToast('Provider 미발견: ' + opts.providerId, 'error');
        return;
    }
    logDbg('  ✓ provider 매치, render() 호출');
    render(_currentProvider);
    logDbg('  ✓ modal active 적용 (display=' + getComputedStyle(_modal).display + ')');
}

window.AddKeyModal = { open, close };
export default { open, close };
