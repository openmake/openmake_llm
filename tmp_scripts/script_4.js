function authFetch(url, options) {
            options = options || {};
            var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
            return fetch(url, Object.assign({}, options, { headers: headers, credentials: 'include' }));
        }
        function showToast(msg, type) {
            type = type || 'success';
            var t = document.getElementById('docToast');
            if (!t) return;
            t.textContent = msg;
            t.className = 'toast ' + type + ' show';
            setTimeout(function() { t.classList.remove('show'); }, 3000);
        }
        function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        var currentDocId = null;

        function formatFileSize(bytes) {
            if (!bytes) return '0 B';
            var units = ['B', 'KB', 'MB', 'GB'];
            var i = 0;
            while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
            return bytes.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
        }

        function getDocIcon(type) {
            var icons = { pdf: '📄', txt: '📝', md: '📝', csv: '📊', json: '🔧', xlsx: '📊', xls: '📊', doc: '📃', docx: '📃', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️' };
            return icons[type] || '📎';
        }

        async function loadDocuments() {
            try {
                var res = await authFetch(API_ENDPOINTS.DOCUMENTS);
                var data = await res.json();
                var docs = data.data || data || [];
                var el = document.getElementById('docList');
                if (!el) return;

                if (!Array.isArray(docs) || docs.length === 0) {
                    el.innerHTML = '<div class="empty-state"><h2>업로드된 문서가 없습니다</h2><p>위에서 파일을 드래그하거나 클릭하여 문서를 업로드하세요.</p></div>';
                    renderStats(0, 0);
                    return;
                }

                var totalSize = 0;
                var embeddedCount = 0;
                el.innerHTML = docs.map(function(doc) {
                    var ext = (doc.original_name || doc.filename || '').split('.').pop().toLowerCase();
                    totalSize += (doc.file_size || doc.size || 0);
                    if (doc.has_embeddings || doc.embedding_count > 0) embeddedCount++;
                    var sizeStr = formatFileSize(doc.file_size || doc.size || 0);
                    var dateStr = doc.created_at ? new Date(doc.created_at).toLocaleDateString('ko') : '';
                    var hasEmb = doc.has_embeddings || doc.embedding_count > 0;

                    return '<div class="doc-card" data-doc-id="' + (doc.id || doc.doc_id) + '">' +
                        '<span class="doc-icon">' + getDocIcon(ext) + '</span>' +
                        '<div class="doc-info">' +
                            '<div class="doc-name">' + esc(doc.original_name || doc.filename) + '</div>' +
                            '<div class="doc-meta">' +
                                '<span class="badge-type">' + esc(ext.toUpperCase()) + '</span>' +
                                (hasEmb ? '<span class="badge-type badge-embedded">임베딩 완료</span>' : '') +
                                '<span>' + sizeStr + '</span>' +
                                '<span>' + dateStr + '</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="doc-actions">' +
                            '<button class="btn-secondary btn-sm" onclick="event.stopPropagation(); viewDocDetail(\'' + (doc.id || doc.doc_id) + '\')">상세</button>' +
                            '<button class="btn-danger btn-sm" onclick="event.stopPropagation(); confirmDeleteDoc(\'' + (doc.id || doc.doc_id) + '\', \'' + esc(doc.original_name || doc.filename).replace(/'/g, "\\'") + '\')">삭제</button>' +
                        '</div>' +
                    '</div>';
                }).join('');

                renderStats(docs.length, embeddedCount, totalSize);
            } catch (e) {
                console.error('[Documents] 문서 목록 로드 실패:', e);
                showToast('문서 목록 로드 실패', 'error');
            }
        }

        function renderStats(total, embedded, totalSize) {
            var el = document.getElementById('docStats');
            if (!el) return;
            el.innerHTML =
                '<div class="doc-stat-card"><div class="stat-value">' + (total || 0) + '</div><div class="stat-label">전체 문서</div></div>' +
                '<div class="doc-stat-card"><div class="stat-value">' + (embedded || 0) + '</div><div class="stat-label">임베딩 완료</div></div>' +
                '<div class="doc-stat-card"><div class="stat-value">' + formatFileSize(totalSize || 0) + '</div><div class="stat-label">총 용량</div></div>';
        }

        async function uploadDocument(file) {
            var formData = new FormData();
            formData.append('file', file);

            var progressEl = document.getElementById('uploadProgress');
            var fillEl = document.getElementById('uploadProgressFill');
            var textEl = document.getElementById('uploadProgressText');
            if (progressEl) progressEl.style.display = 'block';
            if (fillEl) fillEl.style.width = '30%';
            if (textEl) textEl.textContent = '업로드 중: ' + esc(file.name);

            try {
                var res = await fetch(API_ENDPOINTS.UPLOAD, {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });
                if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
                var data = await res.json();
                if (data.data && data.success) Object.assign(data, data.data);

                if (fillEl) fillEl.style.width = '100%';
                if (textEl) textEl.textContent = '완료: ' + esc(file.name);

                if (data.success) {
                    showToast('📄 ' + esc(data.filename || file.name) + ' 업로드 완료');
                    setTimeout(function() {
                        if (progressEl) progressEl.style.display = 'none';
                        if (fillEl) fillEl.style.width = '0%';
                    }, 1500);
                    loadDocuments();
                } else {
                    var errMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
                    showToast(errMsg || '업로드 실패', 'error');
                    if (progressEl) progressEl.style.display = 'none';
                }
            } catch (e) {
                console.error('[Documents] 업로드 실패:', e);
                showToast('업로드 오류: ' + e.message, 'error');
                if (progressEl) progressEl.style.display = 'none';
            }
        }

        async function viewDocDetail(docId) {
            currentDocId = docId;
            var modal = document.getElementById('docDetailModal');
            if (modal) modal.classList.add('open');
            var content = document.getElementById('docDetailContent');
            if (content) content.innerHTML = '<div class="loading">불러오는 중...</div>';

            try {
                var res = await authFetch(API_ENDPOINTS.DOCUMENTS + '/' + docId);
                var data = await res.json();
                var doc = data.data || data;

                var title = document.getElementById('docDetailTitle');
                if (title) title.textContent = doc.original_name || doc.filename || '문서 상세';

                var ext = (doc.original_name || doc.filename || '').split('.').pop().toLowerCase();
                var html = '<div class="detail-section"><h3>문서 정보</h3>' +
                    '<p><strong>파일명:</strong> ' + esc(doc.original_name || doc.filename) + '</p>' +
                    '<p><strong>유형:</strong> ' + esc(ext.toUpperCase()) + '</p>' +
                    '<p><strong>크기:</strong> ' + formatFileSize(doc.file_size || doc.size || 0) + '</p>' +
                    '<p><strong>업로드:</strong> ' + (doc.created_at ? new Date(doc.created_at).toLocaleString('ko') : '-') + '</p>' +
                    (doc.text_length ? '<p><strong>텍스트 길이:</strong> ' + Number(doc.text_length).toLocaleString() + '자</p>' : '') +
                    '</div>';

                if (doc.text) {
                    var preview = doc.text.length > 2000 ? doc.text.substring(0, 2000) + '\n\n... (' + (doc.text.length - 2000) + '자 더)' : doc.text;
                    html += '<div class="detail-section"><h3>내용 미리보기</h3><pre>' + esc(preview) + '</pre></div>';
                }

                if (content) content.innerHTML = html;
            } catch (e) {
                console.error('[Documents] 문서 상세 로드 실패:', e);
                if (content) content.innerHTML = '<div class="empty-state"><p>문서 정보를 불러올 수 없습니다</p></div>';
            }
        }

        function closeDocDetail() {
            var modal = document.getElementById('docDetailModal');
            if (modal) modal.classList.remove('open');
        }

        async function confirmDeleteDoc(docId, name) {
            if (!confirm('"' + name + '" 문서를 삭제하시겠습니까?\n벡터 임베딩도 함께 삭제됩니다.')) return;
            await performDelete(docId);
        }

        async function deleteCurrentDoc() {
            if (!currentDocId || !confirm('이 문서를 삭제하시겠습니까?\n벡터 임베딩도 함께 삭제됩니다.')) return;
            await performDelete(currentDocId);
            closeDocDetail();
        }

        async function performDelete(docId) {
            try {
                var res = await fetch(API_ENDPOINTS.DOCUMENTS + '/' + docId, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var data = await res.json();
                var payload = data.data || data;
                if (payload.deleted) {
                    showToast('문서가 삭제되었습니다 (임베딩 ' + (payload.embeddingsDeleted || 0) + '개 삭제)');
                    loadDocuments();
                } else {
                    showToast('삭제 실패', 'error');
                }
            } catch (e) {
                console.error('[Documents] 삭제 실패:', e);
                showToast('삭제 오류: ' + e.message, 'error');
            }
        }

        // Setup upload area interactions
        (function() {
            var uploadArea = document.getElementById('docUploadArea');
            var fileInput = document.getElementById('docFileInput');

            if (uploadArea && fileInput) {
                uploadArea.addEventListener('click', function() { fileInput.click(); });
                fileInput.addEventListener('change', function(e) {
                    if (e.target.files.length > 0) {
                        Array.from(e.target.files).forEach(function(f) { uploadDocument(f); });
                        fileInput.value = '';
                    }
                });
                uploadArea.addEventListener('dragover', function(e) { e.preventDefault(); uploadArea.classList.add('dragover'); });
                uploadArea.addEventListener('dragleave', function() { uploadArea.classList.remove('dragover'); });
                uploadArea.addEventListener('drop', function(e) {
                    e.preventDefault();
                    uploadArea.classList.remove('dragover');
                    if (e.dataTransfer.files.length > 0) {
                        Array.from(e.dataTransfer.files).forEach(function(f) { uploadDocument(f); });
                    }
                });
            }
        })();

        loadDocuments();