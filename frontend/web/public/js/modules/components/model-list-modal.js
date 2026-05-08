/**
 * Model List Modal — OpenRouter 367+ 모델을 전체 화면 팝업으로 표시.
 *
 * Dropdown 의 max-height (420px) 클리핑 해소 + 큰 검색·정렬 영역.
 * window.ModelListModal.open({ models, selected, onSelect }) — caller (model-selector.js)
 * 가 dropdown 안의 "📋 전체 모델 보기" 버튼 클릭 시 호출.
 *
 * 자동 self-attach: import 시 window.ModelListModal = { open, close } 노출.
 *
 * @module components/model-list-modal
 */
'use strict';

let _modal = null;
let _searchQuery = '';
let _models = [];
let _selectedModelId = '';
let _onSelect = null;
let _clickHandler = null;
let _keyHandler = null;

function escAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

function ensure() {
    if (_modal) return _modal;
    _modal = document.createElement('div');
    _modal.className = 'modal-overlay';
    _modal.id = 'modelListModalOverlay';
    document.body.appendChild(_modal);
    return _modal;
}

function sortAndFilter() {
    var q = _searchQuery.toLowerCase();
    var filtered = q
        ? _models.filter(function (m) {
            return (m.modelId || '').toLowerCase().indexOf(q) >= 0
                || (m.name || '').toLowerCase().indexOf(q) >= 0;
        })
        : _models.slice();
    filtered.sort(function (a, b) {
        var aFree = !!a.isFree, bFree = !!b.isFree;
        if (aFree !== bFree) return aFree ? -1 : 1;
        if (!aFree) {
            var aPrice = (a.pricing && a.pricing.input) || 0;
            var bPrice = (b.pricing && b.pricing.input) || 0;
            if (aPrice !== bPrice) return aPrice - bPrice;
        }
        return (a.name || '').localeCompare(b.name || '');
    });
    return filtered;
}

function renderRow(m) {
    var isActive = m.modelId === _selectedModelId;
    var badge = m.isFree
        ? '<span class="badge badge-free">🆓 FREE</span>'
        : (m.pricing
            ? '<span class="price">$' +
                (m.pricing.input != null ? m.pricing.input.toFixed(2) : '?') + ' / $' +
                (m.pricing.output != null ? m.pricing.output.toFixed(2) : '?') +
                ' /1M</span>'
            : '');
    return '<div class="mlm-row' + (isActive ? ' active' : '') + '" data-model-id="' +
        escAttr(m.modelId) + '">' +
        '<span class="mlm-row-name">' + (isActive ? '<span class="check">✓ </span>' : '') +
        escText(m.name) + '</span>' +
        '<span class="mlm-row-id">' + escText(m.modelId.replace('openrouter:', '')) + '</span>' +
        '<span class="mlm-row-meta">' + badge + '</span>' +
        '</div>';
}

function render() {
    var filtered = sortAndFilter();
    var free = filtered.filter(function (m) { return m.isFree; });
    var paid = filtered.filter(function (m) { return !m.isFree; });
    var total = _models.length;
    var fcount = filtered.length;

    var html =
        '<div class="mlm-box">' +
        '<div class="mlm-header">' +
        '<h3>🌐 OpenRouter 모델 — ' +
        (_searchQuery ? fcount + ' / ' + total : total) +
        ' 개</h3>' +
        '<button type="button" class="mlm-close" data-action="close" aria-label="닫기">&times;</button>' +
        '</div>' +
        '<div class="mlm-search-row">' +
        '<input type="text" class="mlm-search" placeholder="🔍 모델 검색 (id 또는 이름)" ' +
        'value="' + escAttr(_searchQuery) + '" autofocus />' +
        '</div>' +
        '<div class="mlm-list">';

    if (free.length > 0) {
        html += '<div class="mlm-subgroup">🆓 무료 (' + free.length + ')</div>';
        for (var i = 0; i < free.length; i++) html += renderRow(free[i]);
    }
    if (paid.length > 0) {
        html += '<div class="mlm-subgroup">💰 유료 (' + paid.length + ')</div>';
        for (var j = 0; j < paid.length; j++) html += renderRow(paid[j]);
    }
    if (free.length === 0 && paid.length === 0) {
        html += '<div class="mlm-empty">검색 결과 없음</div>';
    }

    html += '</div>' +
        '<div class="mlm-footer">' +
        '<span class="mlm-hint">💡 클릭하여 선택. ESC 또는 우상단 ✕ 으로 닫기.</span>' +
        '</div>' +
        '</div>';

    _modal.innerHTML = html;
    bindHandlers();
}

function bindHandlers() {
    var input = _modal.querySelector('.mlm-search');
    if (input) {
        input.addEventListener('input', function (ev) {
            _searchQuery = ev.target.value;
            render();
            var newInput = _modal.querySelector('.mlm-search');
            if (newInput) {
                newInput.focus();
                newInput.setSelectionRange(_searchQuery.length, _searchQuery.length);
            }
        });
    }
    if (_clickHandler && _modal) _modal.removeEventListener('click', _clickHandler);
    _clickHandler = function (ev) {
        var closeBtn = ev.target.closest('[data-action="close"]');
        if (closeBtn || ev.target === _modal) { close(); return; }
        var row = ev.target.closest('.mlm-row');
        if (row && row.dataset.modelId) {
            var picked = row.dataset.modelId;
            close();
            if (typeof _onSelect === 'function') {
                try { _onSelect(picked); } catch (e) { console.warn('[ModelListModal] onSelect 오류:', e); }
            }
        }
    };
    _modal.addEventListener('click', _clickHandler);
}

export function open(opts) {
    opts = opts || {};
    _models = Array.isArray(opts.models) ? opts.models : [];
    _selectedModelId = opts.selected || '';
    _onSelect = opts.onSelect || null;
    _searchQuery = '';
    ensure();
    render();
    _modal.classList.add('active');

    if (_keyHandler) document.removeEventListener('keydown', _keyHandler);
    _keyHandler = function (ev) {
        if (ev.key === 'Escape' && _modal && _modal.classList.contains('active')) {
            close();
        }
    };
    document.addEventListener('keydown', _keyHandler);
}

export function close() {
    if (_modal) _modal.classList.remove('active');
    if (_clickHandler && _modal) {
        _modal.removeEventListener('click', _clickHandler);
        _clickHandler = null;
    }
    if (_keyHandler) {
        document.removeEventListener('keydown', _keyHandler);
        _keyHandler = null;
    }
    _models = [];
    _selectedModelId = '';
    _onSelect = null;
    _searchQuery = '';
}

window.ModelListModal = { open: open, close: close };
