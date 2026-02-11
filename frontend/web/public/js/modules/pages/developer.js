(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _observer = null;

    // Helper to escape HTML for code blocks
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Syntax highlighting helpers (simple regex-based)
    function highlight(code, lang) {
        var html = escapeHtml(code);
        // Comments
        html = html.replace(/(\#.*$|\/\/.*$)/gm, '<span class="tok-com">$1</span>');
        // Strings
        html = html.replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="tok-str">$1</span>');
        // Numbers
        html = html.replace(/\b(\d+)\b/g, '<span class="tok-num">$1</span>');
        // Keywords (basic set)
        var keywords = 'import|from|const|let|var|function|return|if|else|await|async|try|catch|true|false|null|undefined|class|new';
        var keyRegex = new RegExp('\\b(' + keywords + ')\\b', 'g');
        html = html.replace(keyRegex, '<span class="tok-key">$1</span>');
        // Methods/Functions (basic)
        html = html.replace(/\b([a-zA-Z0-9_]+)(?=\()/g, '<span class="tok-func">$1</span>');
        // Punctuation (JSON/JS objects)
        html = html.replace(/([\{\}\[\]\,\:])/g, '<span class="tok-punc">$1</span>');
        
        // Language specific
        if (lang === 'curl') {
            html = html.replace(/(GET|POST|PUT|PATCH|DELETE)/g, '<span class="tok-key">$1</span>');
            html = html.replace(/(-H|-d|-X)/g, '<span class="tok-param">$1</span>');
        }
        return html;
    }

    // Helper to generate code block HTML
    function getCodeBlock(l1, c1, l2, c2, l3, c3) {
        return '<div class="code-group">' +
            '<div class="code-tabs">' +
            '<button class="code-tab active" data-lang="' + l1 + '">' + formatLang(l1) + '</button>' +
            '<button class="code-tab" data-lang="' + l2 + '">' + formatLang(l2) + '</button>' +
            '<button class="code-tab" data-lang="' + l3 + '">' + formatLang(l3) + '</button>' +
            '</div>' +
            '<div class="code-content-wrapper">' +
            '<button class="copy-btn">Copy</button>' +
            '<div class="code-content active" data-lang="' + l1 + '">' + highlight(c1, l1) + '</div>' +
            '<div class="code-content" data-lang="' + l2 + '">' + highlight(c2, l2) + '</div>' +
            '<div class="code-content" data-lang="' + l3 + '">' + highlight(c3, l3) + '</div>' +
            '</div>' +
            '</div>';
    }

    function formatLang(lang) {
        if (lang === 'typescript') return 'TypeScript';
        if (lang === 'curl') return 'cURL';
        if (lang === 'python') return 'Python';
        return lang;
    }

    window.PageModules['developer'] = {
        getHTML: function() {
            var styles = '<style data-spa-style="developer">' +
                '.dev-layout { display: flex; gap: var(--space-8); position: relative; max-width: 1400px; margin: 0 auto; }' +
                '.dev-sidebar { width: 260px; position: sticky; top: var(--space-8); height: calc(100vh - 100px); overflow-y: auto; flex-shrink: 0; padding-right: var(--space-4); display: none; }' +
                '@media (min-width: 900px) { .dev-sidebar { display: block; } }' +
                '.dev-sidebar::-webkit-scrollbar { width: 4px; }' +
                '.dev-sidebar-nav { list-style: none; padding: 0; }' +
                '.dev-sidebar-nav li { margin-bottom: var(--space-1); }' +
                '.dev-sidebar-link { display: block; padding: var(--space-2) var(--space-3); color: var(--text-muted); text-decoration: none; border-radius: var(--radius-md); font-size: var(--font-size-sm); transition: all var(--transition-fast); border-left: 2px solid transparent; }' +
                '.dev-sidebar-link:hover { color: var(--text-primary); background: var(--bg-hover); }' +
                '.dev-sidebar-link.active { color: var(--accent-primary); border-left-color: var(--accent-primary); background: var(--accent-primary-light); font-weight: var(--font-weight-medium); }' +
                '.dev-sidebar-sub { padding-left: var(--space-4); margin-top: var(--space-1); display: none; }' +
                '.dev-sidebar-link.active + .dev-sidebar-sub, .dev-sidebar-sub:hover { display: block; }' +
                
                '.dev-content { flex: 1; min-width: 0; padding-bottom: var(--space-16); }' +
                '.dev-section { margin-bottom: var(--space-12); scroll-margin-top: 100px; }' +
                '.dev-section h2 { font-size: var(--font-size-2xl); margin-bottom: var(--space-6); border-bottom: 1px solid var(--border-light); padding-bottom: var(--space-2); }' +
                '.dev-section h3 { font-size: var(--font-size-xl); margin: var(--space-8) 0 var(--space-4); color: var(--text-primary); }' +
                '.dev-section p { margin-bottom: var(--space-4); line-height: 1.6; color: var(--text-secondary); }' +
                
                '.endpoint-badge { display: inline-block; padding: 2px 8px; border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-weight: bold; margin-right: var(--space-2); text-transform: uppercase; letter-spacing: 0.5px; }' +
                '.badge-get { background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.2); }' +
                '.badge-post { background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.2); }' +
                '.badge-put, .badge-patch { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.2); }' +
                '.badge-delete { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); }' +
                
                '.code-group { border: 1px solid var(--border-light); border-radius: var(--radius-lg); overflow: hidden; margin: var(--space-6) 0; background: #1e1e1e; box-shadow: var(--shadow-md); }' +
                '.code-tabs { display: flex; background: #252526; border-bottom: 1px solid #333; }' +
                '.code-tab { background: transparent; border: none; padding: var(--space-3) var(--space-5); color: #888; cursor: pointer; font-family: var(--font-sans); font-size: var(--font-size-sm); transition: color 0.2s; }' +
                '.code-tab:hover { color: #fff; }' +
                '.code-tab.active { color: var(--accent-primary); border-bottom: 2px solid var(--accent-primary); font-weight: 500; color: #fff; }' +
                '.code-content-wrapper { position: relative; }' +
                '.code-content { display: none; padding: var(--space-5); overflow-x: auto; font-family: var(--font-mono); font-size: 0.9rem; line-height: 1.5; color: #d4d4d4; }' +
                '.code-content.active { display: block; }' +
                '.copy-btn { position: absolute; top: var(--space-2); right: var(--space-2); background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.1); color: #ccc; padding: 4px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-xs); opacity: 0; transition: all 0.2s; }' +
                '.code-group:hover .copy-btn { opacity: 1; }' +
                '.copy-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }' +
                
                '/* Syntax Highlighting */' +
                '.tok-key { color: #569cd6; }' +
                '.tok-str { color: #ce9178; }' +
                '.tok-num { color: #b5cea8; }' +
                '.tok-com { color: #6a9955; }' +
                '.tok-func { color: #dcdcaa; }' +
                '.tok-param { color: #9cdcfe; }' +
                '.tok-punc { color: #d4d4d4; }' +
                
                '.param-table { width: 100%; border-collapse: collapse; margin-bottom: var(--space-6); font-size: var(--font-size-sm); }' +
                '.param-table th { text-align: left; padding: var(--space-3); border-bottom: 1px solid var(--border-medium); color: var(--text-muted); font-weight: 600; }' +
                '.param-table td { padding: var(--space-3); border-bottom: 1px solid var(--border-light); vertical-align: top; line-height: 1.6; }' +
                '.param-name { font-family: var(--font-mono); color: var(--accent-primary); font-weight: 600; }' +
                '.param-type { font-family: var(--font-mono); color: var(--text-muted); font-size: 0.85em; display: block; margin-top: 4px; }' +
                
                '.rate-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--border-light); border-radius: var(--radius-lg); overflow: hidden; margin: var(--space-6) 0; }' +
                '.rate-table th, .rate-table td { padding: var(--space-3) var(--space-4); text-align: left; border-bottom: 1px solid var(--border-light); }' +
                '.rate-table th { background: var(--bg-card); font-weight: 600; color: var(--text-secondary); }' +
                '.rate-table tr:last-child td { border-bottom: none; }' +
                '.rate-table tr:hover td { background: var(--bg-hover); }' +
                
                '.intro-card { background: var(--bg-card); border-radius: var(--radius-lg); padding: var(--space-6); margin-bottom: var(--space-8); border: 1px solid var(--border-light); }' +
                '.intro-card h3 { margin-top: 0; }' +
                
                '@media (max-width: 899px) { .dev-layout { flex-direction: column; } .dev-sidebar { display: none; } }' +
                '</style>';

            var sidebar = '<nav class="dev-sidebar">' +
                '<ul class="dev-sidebar-nav">' +
                '<li><a href="#intro" class="dev-sidebar-link">Introduction</a></li>' +
                '<li><a href="#auth" class="dev-sidebar-link">Authentication</a></li>' +
                '<li><a href="#models" class="dev-sidebar-link">Available Models</a></li>' +
                '<li><a href="#chat" class="dev-sidebar-link">Chat Completions</a></li>' +
                '<li><a href="#apikeys" class="dev-sidebar-link">API Keys</a>' +
                    '<ul class="dev-sidebar-sub">' +
                        '<li><a href="#create-key" class="dev-sidebar-link">Create Key</a></li>' +
                        '<li><a href="#list-keys" class="dev-sidebar-link">List Keys</a></li>' +
                        '<li><a href="#get-key" class="dev-sidebar-link">Get Key</a></li>' +
                    '</ul>' +
                '</li>' +
                '<li><a href="#usage" class="dev-sidebar-link">Usage & Billing</a></li>' +
                '<li><a href="#rate-limits" class="dev-sidebar-link">Rate Limits</a></li>' +
                '<li><a href="#errors" class="dev-sidebar-link">Errors</a></li>' +
                '<li><a href="#sdks" class="dev-sidebar-link">SDKs</a></li>' +
                '</ul>' +
                '</nav>';

            // CONTENT GENERATION
            var content = '<div class="dev-content">';
            
            // 1. INTRO
            content += '<section id="intro" class="dev-section">' +
                '<h1 style="font-size: var(--font-size-3xl); margin-bottom: var(--space-4);">API Documentation</h1>' +
                '<p class="text-lg">Build AI-powered applications with the OpenMake LLM API. Our API is designed to be compatible with standard industry formats, making integration seamless.</p>' +
                '<div class="intro-card">' +
                '<h3 class="text-accent">Base URL</h3>' +
                '<code style="font-size: 1.1em; background: var(--bg-tertiary); padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); display: block; margin-top: var(--space-2);">https://api.openmake.ai/api/v1</code>' +
                '<p style="margin-top: var(--space-4); font-size: var(--font-size-sm);">All API requests must be made over HTTPS. Calls made over plain HTTP will fail. API requests without authentication will also fail.</p>' +
                '</div>' +
                '</section>';

            // 2. AUTH
            content += '<section id="auth" class="dev-section">' +
                '<h2>Authentication</h2>' +
                '<p>The OpenMake API uses API keys to authenticate requests. You can view and manage your API keys in the <a href="/api-keys.html" class="text-accent">API 키 관리</a> page.</p>' +
                '<p>Your API keys carry many privileges, so be sure to keep them secure! Do not share your secret API keys in publicly accessible areas such as GitHub, client-side code, etc.</p>' +
                
                '<h3>Authentication Methods</h3>' +
                '<p>We support three methods of authentication, in order of preference:</p>' +
                '<ol style="margin-left: 20px; margin-bottom: 20px; color: var(--text-secondary); line-height: 1.8;">' +
                '<li style="margin-bottom: 8px;"><strong>Header (Recommended):</strong> <code>X-API-Key: omk_live_...</code></li>' +
                '<li style="margin-bottom: 8px;"><strong>Bearer Token:</strong> <code>Authorization: Bearer omk_live_...</code></li>' +
                '<li style="margin-bottom: 8px;"><strong>Query Parameter:</strong> <code>?api_key=omk_live_...</code></li>' +
                '</ol>' +
                
                getCodeBlock('curl', 'curl https://api.openmake.ai/api/v1/models \\\n  -H "X-API-Key: omk_live_sk_xxxxxxxxxxxxxxxxxxxx"', 
                             'python', 'import requests\n\nheaders = {"X-API-Key": "omk_live_sk_xxxxxxxxxxxxxxxxxxxx"}\nresponse = requests.get("https://api.openmake.ai/api/v1/models", headers=headers)',
                             'typescript', 'const response = await fetch("https://api.openmake.ai/api/v1/models", {\n  headers: {\n    "X-API-Key": "omk_live_sk_xxxxxxxxxxxxxxxxxxxx"\n  }\n});') +
                '</section>';

            // 3. MODELS
            content += '<section id="models" class="dev-section">' +
                '<h2>Available Models</h2>' +
                '<p>OpenMake offers a range of models suitable for different tasks and price points.</p>' +
                '<table class="rate-table">' +
                '<thead><tr><th>Model Alias</th><th>Description</th><th>Use Case</th></tr></thead>' +
                '<tbody>' +
                '<tr><td><span class="param-name">openmake_llm</span></td><td>Balanced General</td><td>Standard chat, content generation</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_pro</span></td><td>Premium Quality</td><td>Complex instructions, creative writing</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_fast</span></td><td>Speed Optimized</td><td>Real-time chat, simple tasks</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_think</span></td><td>Deep Reasoning</td><td>Math, logic, complex analysis</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_code</span></td><td>Code Specialist</td><td>Programming, debugging, refactoring</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_vision</span></td><td>Multimodal</td><td>Image analysis, OCR</td></tr>' +
                '</tbody></table>' +

                // Feature matrix / Capabilities comparison
                '<h3>Feature Matrix</h3>' +
                '<p>Each model has different capabilities tuned for its use case.</p>' +
                '<table class="rate-table">' +
                '<thead><tr>' +
                '<th>Model</th><th>Agent (A2A)</th><th>Thinking</th><th>Discussion</th><th>Vision</th><th>Max Agent Turns</th><th>Time Budget</th>' +
                '</tr></thead>' +
                '<tbody>' +
                '<tr><td><span class="param-name">openmake_llm</span></td><td>Conditional</td><td>Medium</td><td>—</td><td>—</td><td>5</td><td>Unlimited</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_pro</span></td><td>Always</td><td>High</td><td>✓</td><td>—</td><td>8</td><td>Unlimited</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_fast</span></td><td>—</td><td>—</td><td>—</td><td>—</td><td>1</td><td>3s</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_think</span></td><td>Always</td><td>High</td><td>—</td><td>—</td><td>10</td><td>Unlimited</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_code</span></td><td>Conditional</td><td>Medium</td><td>—</td><td>—</td><td>8</td><td>Unlimited</td></tr>' +
                '<tr><td><span class="param-name">openmake_llm_vision</span></td><td>Conditional</td><td>Medium</td><td>—</td><td>✓</td><td>3</td><td>Unlimited</td></tr>' +
                '</tbody></table>' +

                '<div class="alert-info" style="margin-top: 1rem; padding: 0.75rem 1rem; border-left: 3px solid #3b82f6; background: rgba(59,130,246,0.08); border-radius: 4px;">' +
                '<strong>Note:</strong> Internal engine models are abstracted behind these aliases. ' +
                'The actual engine may change without notice as we optimize quality and performance. ' +
                'Always reference models by their <code>openmake_llm_*</code> alias.</div>' +
                '</section>';

            // 4. CHAT
            content += '<section id="chat" class="dev-section">' +
                '<h2>Chat Completions</h2>' +
                '<p><span class="endpoint-badge badge-post">POST</span> <code>/chat/completions</code></p>' +
                '<p>Creates a model response for the given chat conversation. Fully compatible with OpenAI API format.</p>' +
                
                '<h3>Request Body</h3>' +
                '<table class="param-table">' +
                '<tr><td style="width: 200px;"><span class="param-name">model</span><span class="param-type">string</span></td><td>Required. ID of the model to use (e.g., <code>openmake_llm</code>).</td></tr>' +
                '<tr><td><span class="param-name">messages</span><span class="param-type">array</span></td><td>Required. A list of messages comprising the conversation so far. Each message should have a <code>role</code> (system, user, assistant) and <code>content</code>.</td></tr>' +
                '<tr><td><span class="param-name">temperature</span><span class="param-type">number</span></td><td>Optional. Sampling temperature (0 to 2). Defaults to 1. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.</td></tr>' +
                '</table>' +

                getCodeBlock(
                    'curl', 
                    'curl https://api.openmake.ai/api/v1/chat/completions \\\n' +
                    '  -H "Content-Type: application/json" \\\n' +
                    '  -H "X-API-Key: omk_live_sk_..." \\\n' +
                    '  -d \'{\n' +
                    '    "model": "openmake_llm",\n' +
                    '    "messages": [\n' +
                    '      {"role": "system", "content": "You are a helpful assistant."},\n' +
                    '      {"role": "user", "content": "Hello!"}\n' +
                    '    ]\n' +
                    '  }\'',
                    'python',
                    'import requests\n\n' +
                    'url = "https://api.openmake.ai/api/v1/chat/completions"\n' +
                    'headers = {\n' +
                    '    "X-API-Key": "omk_live_sk_...",\n' +
                    '    "Content-Type": "application/json"\n' +
                    '}\n' +
                    'data = {\n' +
                    '    "model": "openmake_llm",\n' +
                    '    "messages": [\n' +
                    '        {"role": "system", "content": "You are a helpful assistant."},\n' +
                    '        {"role": "user", "content": "Hello!"}\n' +
                    '    ]\n' +
                    '}\n' +
                    'response = requests.post(url, headers=headers, json=data)\n' +
                    'print(response.json())',
                    'typescript',
                    'const response = await fetch("https://api.openmake.ai/api/v1/chat/completions", {\n' +
                    '  method: "POST",\n' +
                    '  headers: {\n' +
                    '    "Content-Type": "application/json",\n' +
                    '    "X-API-Key": "omk_live_sk_..."\n' +
                    '  },\n' +
                    '  body: JSON.stringify({\n' +
                    '    model: "openmake_llm",\n' +
                    '    messages: [\n' +
                    '      {role: "system", content: "You are a helpful assistant."},\n' +
                    '      {role: "user", content: "Hello!"}\n' +
                    '    ]\n' +
                    '  })\n' +
                    '});\n' +
                    'const data = await response.json();'
                ) +
                '</section>';

            // 5. API KEYS
            content += '<section id="apikeys" class="dev-section">' +
                '<h2>API Keys Management</h2>' +
                '<p>Programmatically manage your API keys. Useful for rotating keys or managing access for different services.</p>' +
                
                '<h3 id="create-key">Create Key</h3>' +
                '<p><span class="endpoint-badge badge-post">POST</span> <code>/api-keys</code></p>' +
                '<p>Create a new API key with optional name and expiration.</p>' +
                getCodeBlock(
                    'curl',
                    'curl -X POST https://api.openmake.ai/api/v1/api-keys \\\n' +
                    '  -H "X-API-Key: omk_live_sk_..." \\\n' +
                    '  -H "Content-Type: application/json" \\\n' +
                    '  -d \'{"name": "New Service Key"}\'',
                    'python',
                    'requests.post("https://api.openmake.ai/api/v1/api-keys", \n' +
                    '    headers={"X-API-Key": "key"}, \n' +
                    '    json={"name": "New Service Key"})',
                    'typescript',
                    'await fetch("https://api.openmake.ai/api/v1/api-keys", {\n' +
                    '  method: "POST",\n' +
                    '  headers: {"X-API-Key": "key", "Content-Type": "application/json"},\n' +
                    '  body: JSON.stringify({name: "New Service Key"})\n' +
                    '})'
                ) +

                '<h3 id="list-keys" style="margin-top:60px;">List Keys</h3>' +
                '<p><span class="endpoint-badge badge-get">GET</span> <code>/api-keys</code></p>' +
                '<p>Returns a list of all API keys for the current account.</p>' +
                getCodeBlock(
                    'curl',
                    'curl https://api.openmake.ai/api/v1/api-keys \\\n  -H "X-API-Key: omk_live_sk_..."',
                    'python', 'requests.get("https://api.openmake.ai/api/v1/api-keys", headers=...)',
                    'typescript', 'fetch("https://api.openmake.ai/api/v1/api-keys", ...)'
                ) +
                
                '<h3 id="get-key" style="margin-top:60px;">Get Key Details</h3>' +
                '<p><span class="endpoint-badge badge-get">GET</span> <code>/api-keys/:id</code></p>' +
                '<p>Get metadata for a specific key (never returns the full secret key after creation).</p>' +
                
                '<h3 style="margin-top:60px;">Rotate Key</h3>' +
                '<p><span class="endpoint-badge badge-post">POST</span> <code>/api-keys/:id/rotate</code></p>' +
                '<p>Invalidates the old key immediately and returns a new secret key.</p>' +
                '</section>';

            // 6. USAGE
            content += '<section id="usage" class="dev-section">' +
                '<h2>Usage & Billing</h2>' +
                '<p><span class="endpoint-badge badge-get">GET</span> <code>/usage</code></p>' +
                '<p>Get current usage statistics for the billing period.</p>' +
                getCodeBlock(
                    'curl',
                    'curl https://api.openmake.ai/api/v1/usage \\\n  -H "X-API-Key: omk_live_sk_..."',
                    'python', 'requests.get("https://api.openmake.ai/api/v1/usage", ...)',
                    'typescript', 'fetch("https://api.openmake.ai/api/v1/usage", ...)'
                ) +
                '</section>';

            // 7. RATE LIMITS
            content += '<section id="rate-limits" class="dev-section">' +
                '<h2>Rate Limits</h2>' +
                '<p>API access is rate-limited based on your subscription tier.</p>' +
                '<table class="rate-table">' +
                '<thead><tr><th>Tier</th><th>RPM</th><th>TPM</th><th>Daily Requests</th><th>Monthly Requests</th></tr></thead>' +
                '<tbody>' +
                '<tr><td>Free (Tier 0)</td><td>10</td><td>10,000</td><td>100</td><td>1,000</td></tr>' +
                '<tr><td>Starter (Tier 1)</td><td>30</td><td>50,000</td><td>500</td><td>10,000</td></tr>' +
                '<tr><td>Standard (Tier 2)</td><td>60</td><td>100,000</td><td>3,000</td><td>100,000</td></tr>' +
                '<tr><td>Enterprise (Tier 3)</td><td>300</td><td>1,000,000</td><td>Unlimited</td><td>Unlimited</td></tr>' +
                '</tbody></table>' +
                '<h3>Rate Limit Headers</h3>' +
                '<p>Every response includes headers describing your current rate limit status:</p>' +
                '<ul>' +
                '<li><code>X-RateLimit-Limit</code>: The maximum number of requests allowed in the current period.</li>' +
                '<li><code>X-RateLimit-Remaining</code>: The number of requests remaining in the current period.</li>' +
                '<li><code>X-RateLimit-Reset</code>: The time at which the current rate limit window resets (UTC epoch seconds).</li>' +
                '</ul>' +
                '</section>';

            // 8. ERRORS
            content += '<section id="errors" class="dev-section">' +
                '<h2>Error Handling</h2>' +
                '<p>The API uses standard HTTP status codes to indicate the success or failure of requests.</p>' +
                '<table class="rate-table">' +
                '<thead><tr><th>Code</th><th>Status</th><th>Description</th></tr></thead>' +
                '<tbody>' +
                '<tr><td><code class="text-danger">UNAUTHORIZED</code></td><td>401</td><td>Invalid or missing API key</td></tr>' +
                '<tr><td><code class="text-danger">FORBIDDEN</code></td><td>403</td><td>API key lacks required scope</td></tr>' +
                '<tr><td><code class="text-danger">RATE_LIMITED</code></td><td>429</td><td>Rate limit exceeded</td></tr>' +
                '<tr><td><code class="text-danger">BAD_REQUEST</code></td><td>400</td><td>Invalid request parameters</td></tr>' +
                '<tr><td><code class="text-danger">NOT_FOUND</code></td><td>404</td><td>Resource not found</td></tr>' +
                '<tr><td><code class="text-danger">INTERNAL_ERROR</code></td><td>500</td><td>Server error</td></tr>' +
                '</tbody></table>' +
                '</section>';
                
            content += '<section id="sdks" class="dev-section">' +
                '<h2>SDKs & Libraries</h2>' +
                '<p>Official SDKs for Python and Node.js are coming soon. In the meantime, you can use any standard HTTP client to access the API.</p>' +
                '</section>';

            content += '</div>'; // Close dev-content

            return '<div class="page-developer">' + styles + '<div class="dev-layout">' + sidebar + content + '</div></div>';
        },

        init: function() {
            // Tab Switching Logic
            var layout = document.querySelector('.dev-layout');
            if (layout) {
                layout.addEventListener('click', function(e) {
                    // Handle Tabs
                    if (e.target.classList.contains('code-tab')) {
                        var lang = e.target.getAttribute('data-lang');
                        var group = e.target.closest('.code-group');
                        
                        // Update active tab
                        var tabs = group.querySelectorAll('.code-tab');
                        tabs.forEach(function(t) { t.classList.remove('active'); });
                        e.target.classList.add('active');
                        
                        // Update active content
                        var contents = group.querySelectorAll('.code-content');
                        contents.forEach(function(c) { 
                            c.classList.remove('active');
                            if (c.getAttribute('data-lang') === lang) {
                                c.classList.add('active');
                            }
                        });
                    }

                    // Handle Copy
                    if (e.target.classList.contains('copy-btn')) {
                        var group = e.target.closest('.code-group');
                        var activeContent = group.querySelector('.code-content.active');
                        var text = activeContent.textContent;
                        
                        navigator.clipboard.writeText(text).then(function() {
                            var originalText = e.target.textContent;
                            e.target.textContent = 'Copied!';
                            setTimeout(function() {
                                e.target.textContent = originalText;
                            }, 2000);
                        });
                    }
                });
            }

            // Scrollspy Logic
            var sections = document.querySelectorAll('.dev-section');
            var navLinks = document.querySelectorAll('.dev-sidebar-link');
            
            if (window.IntersectionObserver && sections.length > 0) {
                _observer = new IntersectionObserver(function(entries) {
                    entries.forEach(function(entry) {
                        if (entry.isIntersecting) {
                            var id = entry.target.getAttribute('id');
                            navLinks.forEach(function(link) {
                                link.classList.remove('active');
                                if (link.getAttribute('href') === '#' + id) {
                                    link.classList.add('active');
                                    // Expand parent submenu if exists
                                    var parent = link.closest('.dev-sidebar-sub');
                                    if (parent) {
                                        var parentLink = parent.parentElement.querySelector('a');
                                        if (parentLink) parentLink.classList.add('active');
                                    }
                                }
                            });
                        }
                    });
                }, { threshold: 0.2, rootMargin: "-10% 0px -70% 0px" });
                
                sections.forEach(function(section) {
                    _observer.observe(section);
                });
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            if (_observer) {
                _observer.disconnect();
                _observer = null;
            }
        }
    };
})();
