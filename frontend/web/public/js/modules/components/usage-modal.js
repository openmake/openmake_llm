/**
 * Usage Modal — 외부 LLM provider 사용량 표 모달.
 * UsageModal.open({ providerId? }) — providerId 있으면 필터링.
 *
 * @module components/usage-modal
 */
'use strict';

let _modal = null;
let _clickHandler = null;

function escText(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

function fmt(d) { if (!d) return '-'; try { return new Date(d).toLocaleString('ko-KR'); } catch (_) { return '-'; } }

function fmtUsd(micros) {
    if (!micros) return '-';
    const usd = micros / 1000000;
    if (usd >= 0.01) return '$' + usd.toFixed(4);
    if (usd >= 0.0001) return '$' + usd.toFixed(6);
    return '<$0.0001';
}

async function authFetch(url, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    return (window.authFetch || fetch)(url, opts);
}

function ensure() {
    if (_modal) return _modal;
    _modal = document.createElement('div');
    _modal.className = 'modal-overlay';
    _modal.id = 'usageModalOverlay';
    _modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center';
    document.body.appendChild(_modal);
    return _modal;
}

export function close() {
    if (_modal) _modal.style.display = 'none';
    if (_clickHandler && _modal) {
        _modal.removeEventListener('click', _clickHandler);
        _clickHandler = null;
    }
}

export async function open(opts) {
    opts = opts || {};
    ensure();
    _modal.innerHTML =
        '<div class="modal" style="max-width:720px;width:90%;background:var(--bg-card);border-radius:var(--radius-lg);padding:0;box-shadow:var(--shadow-lg)">' +
        '<div class="modal-header" style="padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center">' +
        '<h3 style="margin:0;font-size:var(--font-size-lg)">📊 외부 LLM 사용량' +
        (opts.providerId ? ' — ' + escText(opts.providerId) : '') +
        '</h3><button data-action="close" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted)">&times;</button></div>' +
        '<div class="modal-body" id="usage-modal-body" style="padding:var(--space-5);max-height:60vh;overflow-y:auto">' +
        '<div style="color:var(--text-muted)">불러오는 중...</div>' +
        '</div></div>';
    _modal.style.display = 'flex';

    _clickHandler = function (ev) {
        if (ev.target.closest('[data-action="close"]')) close();
        else if (ev.target === _modal) close();
    };
    _modal.addEventListener('click', _clickHandler);

    const res = await authFetch('/api/external-keys/usage/recent?limit=50');
    const body = document.getElementById('usage-modal-body');
    if (!body) return;
    if (!res.ok) { body.textContent = '사용량 로드 실패'; return; }
    const json = await res.json();
    const allRows = (json.data && json.data.usage) || [];
    const rows = opts.providerId ? allRows.filter(r => r.provider_id === opts.providerId) : allRows;

    if (!rows.length) {
        body.innerHTML = '<div style="color:var(--text-muted)">기록이 없습니다.</div>';
        return;
    }

    const totalIn = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
    const totalOut = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);
    const totalCost = rows.reduce((s, r) => s + (r.cost_usd_micros || 0), 0);

    body.innerHTML =
        '<div style="margin-bottom:12px;color:var(--text-secondary);font-size:var(--font-size-sm)">' +
        rows.length + '건 — 입력 ' + totalIn.toLocaleString() + ' / 출력 ' + totalOut.toLocaleString() +
        ' 토큰, 비용 누계 <b>' + escText(fmtUsd(totalCost)) +
        '</b> <span style="color:var(--text-muted);font-size:11px">(추정 — 정확한 청구는 각 provider 콘솔 참조)</span></div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead><tr style="text-align:left;color:var(--text-muted);border-bottom:1px solid var(--border-light)">' +
        '<th style="padding:6px 0">시각</th><th>Provider</th><th>모델</th>' +
        '<th style="text-align:right">in</th><th style="text-align:right">out</th>' +
        '<th style="text-align:right">비용</th><th style="text-align:right">지연</th>' +
        '</tr></thead><tbody>' +
        rows.map(r =>
            '<tr style="border-bottom:1px solid var(--border-light)">' +
            '<td style="padding:6px 0;color:var(--text-muted)">' + escText(fmt(r.occurred_at)) + '</td>' +
            '<td>' + escText(r.provider_id) + '</td>' +
            '<td><code style="background:var(--bg-tertiary);padding:1px 4px;border-radius:3px">' + escText(r.model_id) + '</code></td>' +
            '<td style="text-align:right">' + (r.input_tokens || 0).toLocaleString() + '</td>' +
            '<td style="text-align:right">' + (r.output_tokens || 0).toLocaleString() + '</td>' +
            '<td style="text-align:right;color:var(--text-secondary)">' + escText(fmtUsd(r.cost_usd_micros)) + '</td>' +
            '<td style="text-align:right;color:var(--text-muted)">' + (r.duration_ms ? r.duration_ms + 'ms' : '-') + '</td>' +
            '</tr>'
        ).join('') +
        '</tbody></table>';
}

window.UsageModal = { open, close };
export default { open, close };
