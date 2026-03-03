// developer.js 모듈이 로드된 후 HTML 렌더링 및 초기화
        (function() {
            var mod = window.PageModules && window.PageModules['developer'];
            if (mod) {
                var root = document.getElementById('developer-root');
                if (root && typeof mod.getHTML === 'function') {
                    root.innerHTML = mod.getHTML();
                }
                if (typeof mod.init === 'function') {
                    mod.init();
                }
            }
        })();