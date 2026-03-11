/**
 * ============================================
 * Documents Page - 문서 관리 (RAG)
 * ============================================
 * 업로드된 문서를 관리하는 SPA 페이지 모듈입니다.
 * 문서 목록 조회, 업로드, 삭제, 상세 보기, 임베딩 상태 확인.
 *
 * @module pages/documents
 */
'use strict';
    // Module-scoped state
    let _intervals = [];
    var _listeners = [];
    var _currentDocId = null;

    function _authFetch(url, options) {
        options = options || {};
        var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
        return fetch(url, Object.assign({}, options, { headers: headers, credentials: 'include' }));
    }

    function _showToast(msg, type) {
        type = type || 'success';
        var t = document.getElementById('doc-toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'toast ' + type + ' show';
        setTimeout(function() { t.classList.remove('show'); }, 3000);
    }

    function _esc(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function _formatFileSize(bytes) {
        if (!bytes) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = 0;
        while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
        return bytes.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    function _getDocIcon(type) {
        var icons = { pdf: '\uD83D\uDCC4', txt: '\uD83D\uDCDD', md: '\uD83D\uDCDD', csv: '\uD83D\uDCCA', json: '\uD83D\uDD27', xlsx: '\uD83D\uDCCA', xls: '\uD83D\uDCCA', doc: '\uD83D\uDCC3', docx: '\uD83D\uDCC3', png: '\uD83D\uDDBC\uFE0F', jpg: '\uD83D\uDDBC\uFE0F', jpeg: '\uD83D\uDDBC\uFE0F', gif: '\uD83D\uDDBC\uFE0F', webp: '\uD83D\uDDBC\uFE0F' };
        return icons[type] || '\uD83D\uDCCE';
    }

    function _renderStats(total, embedded, totalSize) {
        var el = document.getElementById('docStats');
        if (!el) return;
        el.innerHTML =
            '<div class="doc-stat-card"><div class="stat-value">' + (total || 0) + '</div><div class="stat-label">\uC804\uCCB4 \uBB38\uC11C</div></div>' +
            '<div class="doc-stat-card"><div class="stat-value">' + (embedded || 0) + '</div><div class="stat-label">\uC784\uBCA0\uB529 \uC644\uB8CC</div></div>' +
            '<div class="doc-stat-card"><div class="stat-value">' + _formatFileSize(totalSize || 0) + '</div><div class="stat-label">\uCD1D \uC6A9\uB7C9</div></div>';
    }

    function _loadDocuments() {
        _authFetch(API_ENDPOINTS.DOCUMENTS).then(function(res) {
            return res.json();
        }).then(function(data) {
            var docs = data.data || data || [];
            var el = document.getElementById('docList');
            if (!el) return;

            if (!Array.isArray(docs) || docs.length === 0) {
                el.innerHTML = '<div class="empty-state"><h2>\uC5C5\uB85C\uB4DC\uB41C \uBB38\uC11C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4</h2><p>\uC704\uC5D0\uC11C \uD30C\uC77C\uC744 \uB4DC\uB798\uADF8\uD558\uAC70\uB098 \uD074\uB9AD\uD558\uC5EC \uBB38\uC11C\uB97C \uC5C5\uB85C\uB4DC\uD558\uC138\uC694.</p></div>';
                _renderStats(0, 0, 0);
                return;
            }

            var totalSize = 0;
            var embeddedCount = 0;
            el.innerHTML = docs.map(function(doc) {
                var ext = (doc.original_name || doc.filename || '').split('.').pop().toLowerCase();
                totalSize += (doc.file_size || doc.size || 0);
                if (doc.has_embeddings || doc.embedding_count > 0) embeddedCount++;
                var sizeStr = _formatFileSize(doc.file_size || doc.size || 0);
                var dateStr = doc.created_at ? new Date(doc.created_at).toLocaleDateString('ko') : '';
                var hasEmb = doc.has_embeddings || doc.embedding_count > 0;
                var docId = doc.id || doc.doc_id;

                return '<div class="doc-card" data-doc-id="' + docId + '">' +
                    '<span class="doc-icon">' + _getDocIcon(ext) + '</span>' +
                    '<div class="doc-info">' +
                        '<div class="doc-name">' + _esc(doc.original_name || doc.filename) + '</div>' +
                        '<div class="doc-meta">' +
                            '<span class="badge-type">' + _esc(ext.toUpperCase()) + '</span>' +
                            (hasEmb ? '<span class="badge-type badge-embedded">\uC784\uBCA0\uB529 \uC644\uB8CC</span>' : '') +
                            '<span>' + sizeStr + '</span>' +
                            '<span>' + dateStr + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="doc-actions">' +
                        '<button class="btn-secondary btn-sm doc-btn-detail" data-id="' + docId + '">\uC0C1\uC138</button>' +
                        '<button class="btn-danger btn-sm doc-btn-delete" data-id="' + docId + '" data-name="' + _esc(doc.original_name || doc.filename) + '">\uC0AD\uC81C</button>' +
                    '</div>' +
                '</div>';
            }).join('');

            _renderStats(docs.length, embeddedCount, totalSize);
        }).catch(function(e) {
            console.error('[Documents] \uBB38\uC11C \uBAA9\uB85D \uB85C\uB4DC \uC2E4\uD328:', e);
            _showToast('\uBB38\uC11C \uBAA9\uB85D \uB85C\uB4DC \uC2E4\uD328', 'error');
        });
    }

    function _uploadDocument(file) {
        var formData = new FormData();
        formData.append('file', file);

        var progressEl = document.getElementById('uploadProgress');
        var fillEl = document.getElementById('uploadProgressFill');
        var textEl = document.getElementById('uploadProgressText');
        if (progressEl) progressEl.style.display = 'block';
        if (fillEl) fillEl.style.width = '30%';
        if (textEl) textEl.textContent = '\uC5C5\uB85C\uB4DC \uC911: ' + _esc(file.name);

        fetch(API_ENDPOINTS.UPLOAD, {
            method: 'POST',
            credentials: 'include',
            body: formData
        }).then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
            return res.json();
        }).then(function(data) {
            if (data.data && data.success) Object.assign(data, data.data);

            if (fillEl) fillEl.style.width = '100%';
            if (textEl) textEl.textContent = '\uC644\uB8CC: ' + _esc(file.name);

            if (data.success) {
                _showToast('\uD83D\uDCC4 ' + _esc(data.filename || file.name) + ' \uC5C5\uB85C\uB4DC \uC644\uB8CC');
                setTimeout(function() {
                    if (progressEl) progressEl.style.display = 'none';
                    if (fillEl) fillEl.style.width = '0%';
                }, 1500);
                _loadDocuments();
            } else {
                var errMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
                _showToast(errMsg || '\uC5C5\uB85C\uB4DC \uC2E4\uD328', 'error');
                if (progressEl) progressEl.style.display = 'none';
            }
        }).catch(function(e) {
            console.error('[Documents] \uC5C5\uB85C\uB4DC \uC2E4\uD328:', e);
            _showToast('\uC5C5\uB85C\uB4DC \uC624\uB958: ' + e.message, 'error');
            if (progressEl) progressEl.style.display = 'none';
        });
    }

    function _viewDocDetail(docId) {
        _currentDocId = docId;
        var modal = document.getElementById('docDetailModal');
        if (modal) modal.classList.add('open');
        var content = document.getElementById('docDetailContent');
        if (content) content.innerHTML = '<div class="loading">\uBD88\uB7EC\uC624\uB294 \uC911...</div>';

        _authFetch(API_ENDPOINTS.DOCUMENTS + '/' + docId).then(function(res) {
            return res.json();
        }).then(function(data) {
            var doc = data.data || data;
            var title = document.getElementById('docDetailTitle');
            if (title) title.textContent = doc.original_name || doc.filename || '\uBB38\uC11C \uC0C1\uC138';

            var ext = (doc.original_name || doc.filename || '').split('.').pop().toLowerCase();
            var html = '<div class="detail-section"><h3>\uBB38\uC11C \uC815\uBCF4</h3>' +
                '<p><strong>\uD30C\uC77C\uBA85:</strong> ' + _esc(doc.original_name || doc.filename) + '</p>' +
                '<p><strong>\uC720\uD615:</strong> ' + _esc(ext.toUpperCase()) + '</p>' +
                '<p><strong>\uD06C\uAE30:</strong> ' + _formatFileSize(doc.file_size || doc.size || 0) + '</p>' +
                '<p><strong>\uC5C5\uB85C\uB4DC:</strong> ' + (doc.created_at ? new Date(doc.created_at).toLocaleString('ko') : '-') + '</p>' +
                (doc.text_length ? '<p><strong>\uD14D\uC2A4\uD2B8 \uAE38\uC774:</strong> ' + Number(doc.text_length).toLocaleString() + '\uC790</p>' : '') +
                '</div>';

            if (doc.text) {
                var preview = doc.text.length > 2000 ? doc.text.substring(0, 2000) + '\n\n... (' + (doc.text.length - 2000) + '\uC790 \uB354)' : doc.text;
                html += '<div class="detail-section"><h3>\uB0B4\uC6A9 \uBBF8\uB9AC\uBCF4\uAE30</h3><pre>' + _esc(preview) + '</pre></div>';
            }

            if (content) content.innerHTML = html;
        }).catch(function(e) {
            console.error('[Documents] \uBB38\uC11C \uC0C1\uC138 \uB85C\uB4DC \uC2E4\uD328:', e);
            if (content) content.innerHTML = '<div class="empty-state"><p>\uBB38\uC11C \uC815\uBCF4\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4</p></div>';
        });
    }

    function _closeDocDetail() {
        var modal = document.getElementById('docDetailModal');
        if (modal) modal.classList.remove('open');
    }

    function _confirmDeleteDoc(docId, name) {
        if (!confirm('"' + name + '" \uBB38\uC11C\uB97C \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?\n\uBCA1\uD130 \uC784\uBCA0\uB529\uB3C4 \uD568\uAED8 \uC0AD\uC81C\uB429\uB2C8\uB2E4.')) return;
        _performDelete(docId);
    }

    function _deleteCurrentDoc() {
        if (!_currentDocId || !confirm('\uC774 \uBB38\uC11C\uB97C \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?\n\uBCA1\uD130 \uC784\uBCA0\uB529\uB3C4 \uD568\uAED8 \uC0AD\uC81C\uB429\uB2C8\uB2E4.')) return;
        _performDelete(_currentDocId);
        _closeDocDetail();
    }

    function _performDelete(docId) {
        fetch(API_ENDPOINTS.DOCUMENTS + '/' + docId, {
            method: 'DELETE',
            credentials: 'include'
        }).then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).then(function(data) {
            var payload = data.data || data;
            if (payload.deleted) {
                _showToast('문서가 삭제되었습니다 (임베딩 ' + (payload.embeddingsDeleted || 0) + '개 삭제)');
                // 활성 문서 컨텍스트가 삭제된 문서와 일치하면 해제 (채팅에서 삭제된 문서 인용 방지)
                var activeDoc = window.getState && window.getState('activeDocumentContext');
                if (activeDoc && activeDoc.docId === docId) {
                    window.setState('activeDocumentContext', null);
                    if (window.updateActiveDocumentUI) window.updateActiveDocumentUI();
                }
                // 첨부 파일 목록에서 삭제된 문서 제거 (채팅 페이지에서 stale docId 전송 방지)
                var attachedFiles = window.getState && window.getState('attachedFiles');
                if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
                    var filtered = attachedFiles.filter(function(f) { return f.docId !== docId; });
                    if (filtered.length !== attachedFiles.length) {
                        window.setState('attachedFiles', filtered);
                        if (window.renderAttachments) window.renderAttachments();
                    }
                }
                // 대화 메모리 초기화 (이전 AI 응답이 삭제된 문서를 인용하는 것 방지)
                var memory = window.getState && window.getState('conversationMemory');
                if (Array.isArray(memory) && memory.length > 0) {
                    window.setState('conversationMemory', []);
                }
                _loadDocuments();
            } else {
                _showToast('삭제 실패', 'error');
            }
        }).catch(function(e) {
            console.error('[Documents] 삭제 실패:', e);
            _showToast('삭제 오류: ' + e.message, 'error');
        });
    }

    function _deleteAllDocuments() {
        if (!confirm('업로드된 모든 문서를 삭제하시겠습니까?\n벡터 임베딩도 함께 삭제됩니다.')) return;
        fetch(API_ENDPOINTS.DOCUMENTS, {
            method: 'DELETE',
            credentials: 'include'
        }).then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).then(function(data) {
            var payload = data.data || data;
            _showToast('전체 문서 삭제 완료 (' + (payload.deletedDocuments || 0) + '개 문서, 임베딩 ' + (payload.deletedEmbeddings || 0) + '개 삭제)');
            // 활성 문서 컨텍스트 해제 (채팅에서 삭제된 문서 인용 방지)
            if (window.setState) window.setState('activeDocumentContext', null);
            if (window.updateActiveDocumentUI) window.updateActiveDocumentUI();
            // 첨부 파일 목록 전체 초기화 (모든 문서가 삭제됨)
            if (window.setState) {
                window.setState('attachedFiles', []);
                if (window.renderAttachments) window.renderAttachments();
            }
            // 대화 메모리 초기화 (이전 AI 응답이 삭제된 문서를 인용하는 것 방지)
            var memory = window.getState && window.getState('conversationMemory');
            if (Array.isArray(memory) && memory.length > 0) {
                window.setState('conversationMemory', []);
            }
            _loadDocuments();
        }).catch(function(e) {
            console.error('[Documents] 전체 삭제 실패:', e);
            _showToast('전체 삭제 오류: ' + e.message, 'error');
        });
    }

    const pageModule = {
        getHTML: function() {
            return '<div class="page-documents">' +
                '<style data-spa-style="documents">' +
                '.page-documents .doc-upload-area { background:var(--bg-card); border:2px dashed var(--border-light); border-radius:var(--radius-lg); padding:var(--space-6); margin-bottom:var(--space-5); text-align:center; cursor:pointer; transition:border-color .2s, background .2s; }' +
                '.page-documents .doc-upload-area:hover, .page-documents .doc-upload-area.dragover { border-color:var(--accent-primary); background:var(--bg-secondary); }' +
                '.page-documents .doc-upload-area svg { margin-bottom:var(--space-3); color:var(--text-muted); }' +
                '.page-documents .doc-upload-area p { color:var(--text-secondary); margin:0 0 var(--space-2); }' +
                '.page-documents .doc-upload-area span { color:var(--text-muted); font-size:var(--font-size-sm); }' +
                '.page-documents .doc-upload-area input[type="file"] { display:none; }' +
                '.page-documents .doc-stats { display:flex; gap:var(--space-4); margin-bottom:var(--space-5); flex-wrap:wrap; }' +
                '.page-documents .doc-stat-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-md); padding:var(--space-4); flex:1; min-width:120px; text-align:center; }' +
                '.page-documents .doc-stat-card .stat-value { font-size:1.5rem; font-weight:var(--font-weight-semibold); color:var(--accent-primary); }' +
                '.page-documents .doc-stat-card .stat-label { font-size:var(--font-size-sm); color:var(--text-muted); margin-top:var(--space-1); }' +
                '.page-documents .doc-list { display:flex; flex-direction:column; gap:var(--space-3); }' +
                '.page-documents .doc-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-4) var(--space-5); display:flex; align-items:center; gap:var(--space-4); transition:border-color .2s; }' +
                '.page-documents .doc-card:hover { border-color:var(--accent-primary); }' +
                '.page-documents .doc-card .doc-icon { font-size:1.5rem; flex-shrink:0; }' +
                '.page-documents .doc-card .doc-info { flex:1; min-width:0; }' +
                '.page-documents .doc-card .doc-name { font-weight:var(--font-weight-semibold); color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
                '.page-documents .doc-card .doc-meta { display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap; font-size:var(--font-size-sm); color:var(--text-muted); margin-top:var(--space-1); }' +
                '.page-documents .doc-card .doc-actions { display:flex; gap:var(--space-2); flex-shrink:0; }' +
                '.page-documents .doc-card .doc-actions button { padding:var(--space-1) var(--space-3); border:none; border-radius:var(--radius-md); cursor:pointer; font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }' +
                '.page-documents .badge-type { display:inline-block; padding:2px 10px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); background:var(--bg-tertiary); color:var(--text-secondary); }' +
                '.page-documents .badge-embedded { background:var(--success); color:#fff; }' +
                '.page-documents .btn-primary { padding:var(--space-3) var(--space-5); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); white-space:nowrap; }' +
                '.page-documents .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }' +
                '.page-documents .btn-danger { background:var(--danger); color:#fff; }' +
                '.page-documents .btn-sm { padding:var(--space-1) var(--space-3); font-size:var(--font-size-sm); }' +
                '.page-documents .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }' +
                '.page-documents .modal-overlay.open { display:flex; }' +
                '.page-documents .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:700px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }' +
                '.page-documents .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }' +
                '.page-documents .detail-section { margin-bottom:var(--space-5); }' +
                '.page-documents .detail-section h3 { color:var(--text-secondary); font-size:var(--font-size-sm); margin-bottom:var(--space-2); text-transform:uppercase; letter-spacing:.5px; }' +
                '.page-documents .detail-section p { color:var(--text-primary); line-height:1.6; }' +
                '.page-documents .detail-section pre { background:var(--bg-secondary); padding:var(--space-3); border-radius:var(--radius-md); font-size:var(--font-size-sm); color:var(--text-secondary); max-height:300px; overflow-y:auto; white-space:pre-wrap; word-break:break-word; }' +
                '.page-documents .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); }' +
                '.page-documents .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }' +
                '.page-documents .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }' +
                '.page-documents .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }' +
                '.page-documents .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }' +
                '.page-documents .toast.show { opacity:1; }' +
                '.page-documents .toast.success { background:var(--success); }' +
                '.page-documents .toast.error { background:var(--danger); }' +
                '.page-documents .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }' +
                '.page-documents .upload-progress { margin-top:var(--space-3); }' +
                '.page-documents .upload-progress .progress-bar { height:6px; background:var(--bg-tertiary); border-radius:3px; overflow:hidden; }' +
                '.page-documents .upload-progress .progress-fill { height:100%; background:var(--accent-primary); border-radius:3px; transition:width .3s; }' +
                '.page-documents .upload-progress .progress-text { font-size:var(--font-size-sm); color:var(--text-muted); margin-top:var(--space-1); }' +
                '</style>' +
                '<header class="page-header" style="display:flex;align-items:center;justify-content:space-between;">' +
                    '<h1>문서 관리</h1>' +
                    '<button class="btn-danger btn-sm" id="btnDeleteAllDocs" style="white-space:nowrap;">전체 삭제</button>' +
                '</header>' +
                '<div class="content-area">' +
                    '<div class="doc-upload-area" id="docUploadArea">' +
                        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
                            '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
                            '<polyline points="17 8 12 3 7 8"/>' +
                            '<line x1="12" y1="3" x2="12" y2="15"/>' +
                        '</svg>' +
                        '<p>\uD30C\uC77C\uC744 \uC5EC\uAE30\uC5D0 \uB4DC\uB798\uADF8\uD558\uAC70\uB098 \uD074\uB9AD\uD558\uC5EC \uC5C5\uB85C\uB4DC</p>' +
                        '<span>PDF, \uD14D\uC2A4\uD2B8, \uC774\uBBF8\uC9C0 \uD30C\uC77C \uC9C0\uC6D0</span>' +
                        '<input type="file" id="docFileInput" accept=".pdf,.txt,.md,.csv,.json,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp">' +
                        '<div id="uploadProgress" class="upload-progress" style="display:none">' +
                            '<div class="progress-bar"><div class="progress-fill" id="uploadProgressFill" style="width:0%"></div></div>' +
                            '<div class="progress-text" id="uploadProgressText"></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="doc-stats" id="docStats"></div>' +
                    '<div id="docList" class="doc-list"><div class="loading">\uBB38\uC11C\uB97C \uBD88\uB7EC\uC624\uB294 \uC911...</div></div>' +
                '</div>' +
                '<div class="modal-overlay" id="docDetailModal">' +
                    '<div class="modal">' +
                        '<h2 id="docDetailTitle">\uBB38\uC11C \uC0C1\uC138</h2>' +
                        '<div id="docDetailContent"></div>' +
                        '<div class="modal-actions">' +
                            '<button class="btn-secondary" id="btnCloseDocDetail">\uB2EB\uAE30</button>' +
                            '<button class="btn-danger" id="btnDeleteDoc">\uC0AD\uC81C</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div id="doc-toast" class="toast"></div>' +
            '</div>';
        },

        init: function() {
            _currentDocId = null;

            // Upload area click → file input
            var uploadArea = document.getElementById('docUploadArea');
            var fileInput = document.getElementById('docFileInput');

            if (uploadArea && fileInput) {
                var clickHandler = function() { fileInput.click(); };
                uploadArea.addEventListener('click', clickHandler);
                _listeners.push({ el: uploadArea, type: 'click', fn: clickHandler });

                var changeHandler = function(e) {
                    if (e.target.files.length > 0) {
                        Array.from(e.target.files).forEach(function(f) { _uploadDocument(f); });
                        fileInput.value = '';
                    }
                };
                fileInput.addEventListener('change', changeHandler);
                _listeners.push({ el: fileInput, type: 'change', fn: changeHandler });

                // Drag & drop
                var dragoverHandler = function(e) { e.preventDefault(); uploadArea.classList.add('dragover'); };
                var dragleaveHandler = function() { uploadArea.classList.remove('dragover'); };
                var dropHandler = function(e) {
                    e.preventDefault();
                    uploadArea.classList.remove('dragover');
                    if (e.dataTransfer.files.length > 0) {
                        Array.from(e.dataTransfer.files).forEach(function(f) { _uploadDocument(f); });
                    }
                };
                uploadArea.addEventListener('dragover', dragoverHandler);
                uploadArea.addEventListener('dragleave', dragleaveHandler);
                uploadArea.addEventListener('drop', dropHandler);
                _listeners.push({ el: uploadArea, type: 'dragover', fn: dragoverHandler });
                _listeners.push({ el: uploadArea, type: 'dragleave', fn: dragleaveHandler });
                _listeners.push({ el: uploadArea, type: 'drop', fn: dropHandler });
            }

            // Document list — delegated clicks for detail/delete buttons
            var docList = document.getElementById('docList');
            if (docList) {
                var listClickHandler = function(e) {
                    var detailBtn = e.target.closest('.doc-btn-detail');
                    if (detailBtn) {
                        e.stopPropagation();
                        _viewDocDetail(detailBtn.dataset.id);
                        return;
                    }
                    var deleteBtn = e.target.closest('.doc-btn-delete');
                    if (deleteBtn) {
                        e.stopPropagation();
                        _confirmDeleteDoc(deleteBtn.dataset.id, deleteBtn.dataset.name);
                        return;
                    }
                };
                docList.addEventListener('click', listClickHandler);
                _listeners.push({ el: docList, type: 'click', fn: listClickHandler });
            }

            // Modal buttons
            var btnClose = document.getElementById('btnCloseDocDetail');
            if (btnClose) {
                var closeHandler = function() { _closeDocDetail(); };
                btnClose.addEventListener('click', closeHandler);
                _listeners.push({ el: btnClose, type: 'click', fn: closeHandler });
            }

            var btnDelete = document.getElementById('btnDeleteDoc');
            if (btnDelete) {
                var deleteHandler = function() { _deleteCurrentDoc(); };
                btnDelete.addEventListener('click', deleteHandler);
                _listeners.push({ el: btnDelete, type: 'click', fn: deleteHandler });
            }

            // Delete all button
            var btnDeleteAll = document.getElementById('btnDeleteAllDocs');
            if (btnDeleteAll) {
                var deleteAllHandler = function() { _deleteAllDocuments(); };
                btnDeleteAll.addEventListener('click', deleteAllHandler);
                _listeners.push({ el: btnDeleteAll, type: 'click', fn: deleteAllHandler });
            }

            // Load initial data
            _loadDocuments();
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _listeners.forEach(function(l) { l.el.removeEventListener(l.type, l.fn); });
            _listeners = [];
            _currentDocId = null;
        }
    };

export default pageModule;
