/**
 * Model Action Menu — 등록된 외부 모델 옆 ⋮ 컨텍스트 메뉴.
 * 검증 / 사용량 / 삭제 액션 dispatch.
 *
 * @module components/model-action-menu
 */
'use strict';

let _menu = null;
let _outsideClickHandler = null;

async function authFetch(url, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    return (window.authFetch || fetch)(url, opts);
}

function ensure() {
    if (_menu) return _menu;
    _menu = document.createElement('div');
    _menu.className = 'model-action-menu';
    _menu.style.cssText =
        'position:absolute;background:var(--bg-card);border:1px solid var(--border-light);' +
        'border-radius:6px;padding:4px 0;box-shadow:var(--shadow-lg);z-index:200;' +
        'display:none;min-width:140px';
    document.body.appendChild(_menu);

    _outsideClickHandler = function (ev) {
        if (_menu.style.display === 'block' && !_menu.contains(ev.target)) close();
    };
    document.addEventListener('click', _outsideClickHandler);
    return _menu;
}

export function close() { if (_menu) _menu.style.display = 'none'; }

async function validate(providerId) {
    if (window.showToast) window.showToast('검증 중...');
    try {
        const res = await authFetch(
            '/api/external-keys/' + encodeURIComponent(providerId) + '/validate',
            { method: 'POST' }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = (json.error && (json.error.message || json.error)) || json.message || '검증 실패';
            if (window.showToast) window.showToast(msg, 'error');
        } else {
            const latency = json.data && json.data.latency_ms;
            if (window.showToast) {
                window.showToast('검증 성공' + (latency ? ' (' + latency + 'ms)' : ''));
            }
        }
        if (window.ModelSelector) await window.ModelSelector.refresh();
    } catch (e) {
        if (window.showToast) window.showToast('검증 실패', 'error');
    }
}

async function deleteKey(providerId) {
    if (!confirm("'" + providerId + "' 키를 삭제하시겠습니까? 이 키로 사용 중인 모델 선택이 해제됩니다.")) return;
    try {
        const res = await authFetch(
            '/api/external-keys/' + encodeURIComponent(providerId),
            { method: 'DELETE' }
        );
        if (!res.ok) throw new Error('삭제 실패');
        if (window.showToast) window.showToast('삭제 완료');
        if (window.ModelSelector) await window.ModelSelector.refresh();
    } catch (e) {
        if (window.showToast) window.showToast('삭제 실패', 'error');
    }
}

export function open(triggerEl, ctx) {
    ensure();
    const rect = triggerEl.getBoundingClientRect();
    _menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    _menu.style.left = Math.max(8, rect.left + window.scrollX - 100) + 'px';
    _menu.innerHTML =
        '<div class="menu-item" data-action="validate"><iconify-icon icon=lucide:search-check></iconify-icon> 검증</div>' +
        '<div class="menu-item" data-action="usage"><iconify-icon icon=lucide:bar-chart-2></iconify-icon> 사용량</div>' +
        '<div class="menu-item" data-action="delete" style="color:var(--danger)"><iconify-icon icon=lucide:trash-2></iconify-icon> 삭제</div>';
    _menu.style.display = 'block';

    setTimeout(() => {
        _menu.addEventListener('click', function handler(ev) {
            const item = ev.target.closest('[data-action]');
            if (!item) return;
            ev.stopPropagation();
            const action = item.dataset.action;
            close();
            if (action === 'validate') validate(ctx.providerId);
            else if (action === 'usage' && window.UsageModal) window.UsageModal.open({ providerId: ctx.providerId });
            else if (action === 'delete') deleteKey(ctx.providerId);
        }, { once: true });
    }, 0);
}

window.ModelActionMenu = { open, close };
export default { open, close };
