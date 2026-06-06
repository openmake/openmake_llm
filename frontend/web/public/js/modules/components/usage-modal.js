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
    document.body.appendChild(_modal);
    return _modal;
}

export function close() {
    if (_modal) _modal.classList.remove('active');
    if (_clickHandler && _modal) {
        _modal.removeEventListener('click', _clickHandler);
        _clickHandler = null;
    }
}

export async function open(opts) {
    opts = opts || {};
    ensure();
    _modal.innerHTML =
        '<div class="ek-modal-box wide">' +
        '<div class="ek-modal-box-header">' +
        '<h3><iconify-icon icon=lucide:bar-chart-2></iconify-icon> 외부 LLM 사용량' + (opts.providerId ? ' — ' + escText(opts.providerId) : '') + '</h3>' +
        '<button type="button" class="ek-modal-box-close" data-action="close">&times;</button>' +
        '</div>' +
        '<div class="ek-modal-box-body scrollable" id="usage-modal-body">' +
        '<div style="color:var(--text-muted)">불러오는 중...</div>' +
        '</div></div>';
    _modal.classList.add('active');

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

    // 30일 daily summary 시도 (실패해도 raw 표는 그대로 표시)
    let summaryHtml = '';
    try {
        const sumRes = await authFetch('/api/external-keys/usage/summary?days=30');
        if (sumRes.ok) {
            const sumJson = await sumRes.json();
            const totalsByProvider = (sumJson.data && sumJson.data.totals_by_provider) || [];
            if (totalsByProvider.length > 0) {
                summaryHtml =
                    '<div style="margin-bottom:12px;padding:8px 12px;background:var(--bg-tertiary);border-radius:6px;font-size:12px">' +
                    '<div style="color:var(--text-muted);margin-bottom:6px"><iconify-icon icon=lucide:calendar></iconify-icon> 최근 30일 provider별 누계</div>' +
                    '<table style="width:100%;font-size:12px"><tbody>' +
                    totalsByProvider.map((t) =>
                        '<tr>' +
                        '<td style="padding:2px 0">' + escText(t.provider_id) + '</td>' +
                        '<td style="text-align:right;color:var(--text-muted)">호출 ' + t.call_count.toLocaleString() + '</td>' +
                        '<td style="text-align:right;color:var(--text-muted)">' + (t.input_tokens + t.output_tokens).toLocaleString() + ' tok</td>' +
                        '<td style="text-align:right;color:var(--accent-primary)">' + escText(fmtUsd(t.cost_usd_micros)) + '</td>' +
                        '</tr>'
                    ).join('') +
                    '</tbody></table></div>';
            }
        }
    } catch (_) { /* summary 실패 → 기본 표만 */ }

    body.innerHTML = summaryHtml +
        '<div style="margin-bottom:12px;color:var(--text-secondary);font-size:var(--font-size-sm)">' +
        '<iconify-icon icon=lucide:clock></iconify-icon> 직전 ' + rows.length + '건 — 입력 ' + totalIn.toLocaleString() + ' / 출력 ' + totalOut.toLocaleString() +
        ' 토큰, 비용 <b>' + escText(fmtUsd(totalCost)) +
        '</b> <span style="color:var(--text-muted);font-size:11px">(추정 — 정확한 청구는 각 provider 콘솔)</span></div>' +
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
