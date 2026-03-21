/**
 * Developer Page 섹션 콘텐츠
 * @module pages/developer-sections
 */
import { getCodeBlock } from './developer-helpers.js';

/**
 * 1. Introduction 섹션
 * @returns {string} HTML 문자열
 */
export function renderIntroSection() {
    return '<section id="intro" class="dev-section">' +
        '<h1 style="font-size: var(--font-size-3xl); margin-bottom: var(--space-4);">API Documentation</h1>' +
        '<p class="text-lg">Build AI-powered applications with the OpenMake LLM API. Our API is designed to be compatible with standard industry formats, making integration seamless.</p>' +
        '<div class="intro-card">' +
        '<h3 class="text-accent">Base URL</h3>' +
        '<code style="font-size: 1.1em; background: var(--bg-tertiary); padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); display: block; margin-top: var(--space-2);">' + window.location.origin + '/api/v1</code>' +
        '<p style="margin-top: var(--space-4); font-size: var(--font-size-sm);">All API requests require authentication. API requests without a valid API key will fail.</p>' +
        '</div>' +
        '</section>';
}

/**
 * 2. Authentication 섹션
 * @returns {string} HTML 문자열
 */
export function renderAuthSection() {
    return '<section id="auth" class="dev-section">' +
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

        getCodeBlock('curl', 'curl ' + window.location.origin + '/api/v1/models \\\n  -H "X-API-Key: omk_live_sk_xxxxxxxxxxxxxxxxxxxx"',
                     'python', 'import requests\n\nheaders = {"X-API-Key": "omk_live_sk_xxxxxxxxxxxxxxxxxxxx"}\nresponse = requests.get("' + window.location.origin + '/api/v1/models", headers=headers)',
                     'typescript', 'const response = await fetch("' + window.location.origin + '/api/v1/models", {\n  headers: {\n    "X-API-Key": "omk_live_sk_xxxxxxxxxxxxxxxxxxxx"\n  }\n});') +
        '</section>';
}

/**
 * 3. Available Models 섹션
 * @returns {string} HTML 문자열
 */
export function renderModelsSection() {
    return '<section id="models" class="dev-section">' +
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
        '<tr><td><span class="param-name">openmake_llm_auto</span></td><td>Smart Auto-Routing</td><td>Automatically routes to <strong>pro</strong>, <strong>fast</strong>, <strong>think</strong>, <strong>code</strong>, or <strong>vision</strong> based on query type</td></tr>' +
        '</tbody></table>' +

        // Feature matrix
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
        '<tr><td><span class="param-name">openmake_llm_auto</span></td><td>Auto (per routed model)</td><td>Auto</td><td>Auto</td><td>Auto</td><td>Auto</td><td>Auto</td></tr>' +
        '</tbody></table>' +

        '<div class="alert-info" style="margin-top: 1rem; padding: 0.75rem 1rem; border-left: 3px solid var(--info); background: var(--bg-tertiary); border-radius: 4px;">' +
        '<strong>Note:</strong> Internal engine models are abstracted behind these aliases. ' +
        'The actual engine may change without notice as we optimize quality and performance. ' +
        'Always reference models by their <code>openmake_llm_*</code> alias.</div>' +
        '</section>';
}

/**
 * 4. Chat 섹션
 * @returns {string} HTML 문자열
 */
export function renderChatSection() {
    return '<section id="chat" class="dev-section">' +
        '<h2>Chat</h2>' +
        '<p><span class="endpoint-badge badge-post">POST</span> <code>/chat</code></p>' +
        '<p>Creates a model response for the given message. Returns the AI assistant\'s reply along with a session ID for conversation continuity.</p>' +

        '<h3>Request Body</h3>' +
        '<table class="param-table">' +
        '<tr><td style="width: 200px;"><span class="param-name">message</span><span class="param-type">string</span></td><td>Required. The user\'s message to the AI assistant.</td></tr>' +
        '<tr><td><span class="param-name">model</span><span class="param-type">string</span></td><td>Required. ID of the model to use (e.g., <code>openmake_llm</code>, <code>openmake_llm_auto</code>).</td></tr>' +
        '<tr><td><span class="param-name">sessionId</span><span class="param-type">string</span></td><td>Optional. Session ID from a previous response to continue a conversation.</td></tr>' +
        '<tr><td><span class="param-name">history</span><span class="param-type">array</span></td><td>Optional. Array of previous messages, each with <code>role</code> (<code>user</code>/<code>assistant</code>) and <code>content</code>.</td></tr>' +
        '</table>' +

        '<h3>Response</h3>' +
        '<table class="param-table">' +
        '<tr><td style="width: 200px;"><span class="param-name">response</span><span class="param-type">string</span></td><td>The AI assistant\'s reply.</td></tr>' +
        '<tr><td><span class="param-name">sessionId</span><span class="param-type">string</span></td><td>Session ID for continuing the conversation.</td></tr>' +
        '<tr><td><span class="param-name">model</span><span class="param-type">string</span></td><td>The model alias used for the response.</td></tr>' +
        '</table>' +

        getCodeBlock(
            'curl',
            'curl ' + window.location.origin + '/api/v1/chat \\\n' +
            '  -H "Content-Type: application/json" \\\n' +
            '  -H "X-API-Key: omk_live_sk_..." \\\n' +
            '  -d \'{\n' +
            '    "message": "Hello!",\n' +
            '    "model": "openmake_llm"\n' +
            '  }\'',
            'python',
            'import requests\n\n' +
            'url = "' + window.location.origin + '/api/v1/chat"\n' +
            'headers = {\n' +
            '    "X-API-Key": "omk_live_sk_...",\n' +
            '    "Content-Type": "application/json"\n' +
            '}\n' +
            'data = {\n' +
            '    "message": "Hello!",\n' +
            '    "model": "openmake_llm"\n' +
            '}\n' +
            'response = requests.post(url, headers=headers, json=data)\n' +
            'print(response.json())',
            'typescript',
            'const response = await fetch("' + window.location.origin + '/api/v1/chat", {\n' +
            '  method: "POST",\n' +
            '  headers: {\n' +
            '    "Content-Type": "application/json",\n' +
            '    "X-API-Key": "omk_live_sk_..."\n' +
            '  },\n' +
            '  body: JSON.stringify({\n' +
            '    message: "Hello!",\n' +
            '    model: "openmake_llm"\n' +
            '  })\n' +
            '});\n' +
            'const data = await response.json();'
        ) +

        '<h3>Response Example</h3>' +
        getCodeBlock(
            'curl',
            '{\n' +
            '  "success": true,\n' +
            '  "data": {\n' +
            '    "response": "Hello! How can I help you today?",\n' +
            '    "sessionId": "sess_a1b2c3d4...",\n' +
            '    "model": "openmake_llm",\n' +
            '    "finish_reason": "stop"\n' +
            '  }\n' +
            '}',
            'python',
            '# response.json()\n' +
            '{\n' +
            '  "success": true,\n' +
            '  "data": {\n' +
            '    "response": "Hello! How can I help you today?",\n' +
            '    "sessionId": "sess_a1b2c3d4...",\n' +
            '    "model": "openmake_llm",\n' +
            '    "finish_reason": "stop"\n' +
            '  }\n' +
            '}',
            'typescript',
            '// data\n' +
            '{\n' +
            '  success: true,\n' +
            '  data: {\n' +
            '    response: "Hello! How can I help you today?",\n' +
            '    sessionId: "sess_a1b2c3d4...",\n' +
            '    model: "openmake_llm",\n' +
            '    finish_reason: "stop"\n' +
            '  }\n' +
            '}'
        ) +
        '</section>';
}

/**
 * 4.5. OpenAI Compatibility 섹션
 * @returns {string} HTML 문자열
 */
export function renderOpenAICompatSection() {
    return '<section id="openai-compat" class="dev-section">' +
        '<h2>OpenAI Compatibility</h2>' +
        '<p>OpenMake LLM provides an OpenAI-compatible API, allowing you to use existing OpenAI SDKs and tools with minimal changes. Simply point your SDK to the OpenMake base URL and use your API key.</p>' +

        '<div class="intro-card">' +
        '<h3 class="text-accent">OpenAI-Compatible Base URL</h3>' +
        '<code style="font-size: 1.1em; background: var(--bg-tertiary); padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); display: block; margin-top: var(--space-2);">' + window.location.origin + '/api/v1</code>' +
        '<p style="margin-top: var(--space-4); font-size: var(--font-size-sm);">Use your OpenMake API key as the API key parameter. The format is fully compatible with OpenAI client libraries.</p>' +
        '</div>' +

        // Quick Start with OpenAI SDK
        '<h3>Quick Start with OpenAI SDK</h3>' +
        getCodeBlock(
            'python',
            'from openai import OpenAI\n\n' +
            'client = OpenAI(\n' +
            '    base_url="' + window.location.origin + '/api/v1",\n' +
            '    api_key="omk_live_sk_..."\n' +
            ')\n\n' +
            'response = client.chat.completions.create(\n' +
            '    model="openmake_llm",\n' +
            '    messages=[\n' +
            '        {"role": "user", "content": "Hello!"}\n' +
            '    ]\n' +
            ')\n' +
            'print(response.choices[0].message.content)',
            'typescript',
            'import OpenAI from "openai";\n\n' +
            'const client = new OpenAI({\n' +
            '  baseURL: "' + window.location.origin + '/api/v1",\n' +
            '  apiKey: "omk_live_sk_..."\n' +
            '});\n\n' +
            'const response = await client.chat.completions.create({\n' +
            '  model: "openmake_llm",\n' +
            '  messages: [\n' +
            '    { role: "user", content: "Hello!" }\n' +
            '  ]\n' +
            '});\n' +
            'console.log(response.choices[0].message.content);',
            'curl',
            'curl ' + window.location.origin + '/api/v1/chat/completions \\\n' +
            '  -H "Content-Type: application/json" \\\n' +
            '  -H "Authorization: Bearer omk_live_sk_..." \\\n' +
            '  -d \'{\n' +
            '    "model": "openmake_llm",\n' +
            '    "messages": [\n' +
            '      {"role": "user", "content": "Hello!"}\n' +
            '    ]\n' +
            '  }\''
        ) +

        // Chat Completions
        '<h3 id="chat-completions">POST /chat/completions</h3>' +
        '<p><span class="endpoint-badge badge-post">POST</span> <code>/chat/completions</code></p>' +
        '<p>Creates a chat completion. Compatible with the OpenAI Chat Completions API format.</p>' +

        '<h3>Request Body</h3>' +
        '<table class="param-table">' +
        '<tr><td style="width: 200px;"><span class="param-name">model</span><span class="param-type">string</span></td><td>Required. Model ID (e.g., <code>openmake_llm</code>, <code>openmake_llm_auto</code>).</td></tr>' +
        '<tr><td><span class="param-name">messages</span><span class="param-type">array</span></td><td>Required. Array of message objects with <code>role</code> (<code>system</code>, <code>user</code>, <code>assistant</code>, <code>tool</code>) and <code>content</code>.</td></tr>' +
        '<tr><td><span class="param-name">stream</span><span class="param-type">boolean</span></td><td>Optional. If <code>true</code>, returns a stream of Server-Sent Events (SSE). Default: <code>false</code>.</td></tr>' +
        '<tr><td><span class="param-name">temperature</span><span class="param-type">number</span></td><td>Optional. Sampling temperature (0&ndash;2). Higher values produce more random output.</td></tr>' +
        '<tr><td><span class="param-name">max_tokens</span><span class="param-type">integer</span></td><td>Optional. Maximum number of tokens to generate.</td></tr>' +
        '<tr><td><span class="param-name">top_p</span><span class="param-type">number</span></td><td>Optional. Nucleus sampling parameter (0&ndash;1).</td></tr>' +
        '<tr><td><span class="param-name">stop</span><span class="param-type">string | array</span></td><td>Optional. Stop sequence(s) where generation should halt.</td></tr>' +
        '<tr><td><span class="param-name">tools</span><span class="param-type">array</span></td><td>Optional. List of tool/function definitions the model may call. See <a href="#tool-calling" class="text-accent">Tool Calling</a> below.</td></tr>' +
        '<tr><td><span class="param-name">tool_choice</span><span class="param-type">string | object</span></td><td>Optional. Controls tool selection: <code>"auto"</code>, <code>"none"</code>, <code>"required"</code>, or a specific function.</td></tr>' +
        '<tr><td><span class="param-name">presence_penalty</span><span class="param-type">number</span></td><td>Optional. Penalizes tokens based on presence in text so far.</td></tr>' +
        '<tr><td><span class="param-name">frequency_penalty</span><span class="param-type">number</span></td><td>Optional. Penalizes tokens based on frequency in text so far.</td></tr>' +
        '</table>' +

        '<h3>Response (Non-Streaming)</h3>' +
        getCodeBlock(
            'curl',
            '{\n' +
            '  "id": "chatcmpl-abc123def456...",\n' +
            '  "object": "chat.completion",\n' +
            '  "created": 1709827200,\n' +
            '  "model": "openmake_llm",\n' +
            '  "choices": [\n' +
            '    {\n' +
            '      "index": 0,\n' +
            '      "message": {\n' +
            '        "role": "assistant",\n' +
            '        "content": "Hello! How can I help you today?"\n' +
            '      },\n' +
            '      "finish_reason": "stop"\n' +
            '    }\n' +
            '  ],\n' +
            '  "usage": {\n' +
            '    "prompt_tokens": 12,\n' +
            '    "completion_tokens": 9,\n' +
            '    "total_tokens": 21\n' +
            '  }\n' +
            '}',
            'python',
            '# response object\n' +
            'response.id           # "chatcmpl-abc123def456..."\n' +
            'response.model        # "openmake_llm"\n' +
            'response.choices[0].message.content\n' +
            '                      # "Hello! How can I help you today?"\n' +
            'response.choices[0].finish_reason\n' +
            '                      # "stop"\n' +
            'response.usage.total_tokens  # 21',
            'typescript',
            '// response object\n' +
            '{\n' +
            '  id: "chatcmpl-abc123def456...",\n' +
            '  object: "chat.completion",\n' +
            '  created: 1709827200,\n' +
            '  model: "openmake_llm",\n' +
            '  choices: [{\n' +
            '    index: 0,\n' +
            '    message: { role: "assistant", content: "Hello! ..." },\n' +
            '    finish_reason: "stop"\n' +
            '  }],\n' +
            '  usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 }\n' +
            '}'
        ) +

        // Streaming
        '<h3 id="openai-streaming">Streaming</h3>' +
        '<p>Set <code>"stream": true</code> to receive responses as Server-Sent Events (SSE). Each event is a JSON chunk prefixed with <code>data: </code>. The stream ends with <code>data: [DONE]</code>.</p>' +

        getCodeBlock(
            'curl',
            'curl ' + window.location.origin + '/api/v1/chat/completions \\\n' +
            '  -H "Content-Type: application/json" \\\n' +
            '  -H "Authorization: Bearer omk_live_sk_..." \\\n' +
            '  -d \'{\n' +
            '    "model": "openmake_llm",\n' +
            '    "stream": true,\n' +
            '    "messages": [\n' +
            '      {"role": "user", "content": "Tell me a joke"}\n' +
            '    ]\n' +
            '  }\'',
            'python',
            'stream = client.chat.completions.create(\n' +
            '    model="openmake_llm",\n' +
            '    messages=[{"role": "user", "content": "Tell me a joke"}],\n' +
            '    stream=True\n' +
            ')\n\n' +
            'for chunk in stream:\n' +
            '    delta = chunk.choices[0].delta\n' +
            '    if delta.content:\n' +
            '        print(delta.content, end="", flush=True)',
            'typescript',
            'const stream = await client.chat.completions.create({\n' +
            '  model: "openmake_llm",\n' +
            '  messages: [{ role: "user", content: "Tell me a joke" }],\n' +
            '  stream: true\n' +
            '});\n\n' +
            'for await (const chunk of stream) {\n' +
            '  const content = chunk.choices[0]?.delta?.content;\n' +
            '  if (content) process.stdout.write(content);\n' +
            '}'
        ) +

        '<h3>Stream Response Format</h3>' +
        '<p>Each SSE event contains a <code>chat.completion.chunk</code> object:</p>' +
        getCodeBlock(
            'curl',
            '// First chunk (role)\n' +
            'data: {"id":"chatcmpl-abc...","object":"chat.completion.chunk","created":1709827200,"model":"openmake_llm","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n' +
            '// Content chunks\n' +
            'data: {"id":"chatcmpl-abc...","object":"chat.completion.chunk","created":1709827200,"model":"openmake_llm","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
            'data: {"id":"chatcmpl-abc...","object":"chat.completion.chunk","created":1709827200,"model":"openmake_llm","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}\n\n' +
            '// Final chunk\n' +
            'data: {"id":"chatcmpl-abc...","object":"chat.completion.chunk","created":1709827200,"model":"openmake_llm","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
            'data: [DONE]',
            'python',
            '# Each chunk object:\n' +
            'chunk.id                              # "chatcmpl-abc..."\n' +
            'chunk.object                          # "chat.completion.chunk"\n' +
            'chunk.choices[0].delta.content        # "Hello" (partial text)\n' +
            'chunk.choices[0].finish_reason        # null or "stop"',
            'typescript',
            '// Each chunk object:\n' +
            '{\n' +
            '  id: "chatcmpl-abc...",\n' +
            '  object: "chat.completion.chunk",\n' +
            '  created: 1709827200,\n' +
            '  model: "openmake_llm",\n' +
            '  choices: [{\n' +
            '    index: 0,\n' +
            '    delta: { content: "Hello" },  // partial text\n' +
            '    finish_reason: null             // null until done\n' +
            '  }]\n' +
            '}'
        ) +

        // Tool Calling
        '<h3 id="tool-calling">Tool Calling</h3>' +
        '<p>The Chat Completions API supports function/tool calling. Define tools in the request, and the model may return <code>tool_calls</code> in its response.</p>' +

        getCodeBlock(
            'curl',
            'curl ' + window.location.origin + '/api/v1/chat/completions \\\n' +
            '  -H "Content-Type: application/json" \\\n' +
            '  -H "Authorization: Bearer omk_live_sk_..." \\\n' +
            '  -d \'{\n' +
            '    "model": "openmake_llm_pro",\n' +
            '    "messages": [\n' +
            '      {"role": "user", "content": "What is the weather in Seoul?"}\n' +
            '    ],\n' +
            '    "tools": [\n' +
            '      {\n' +
            '        "type": "function",\n' +
            '        "function": {\n' +
            '          "name": "get_weather",\n' +
            '          "description": "Get current weather for a location",\n' +
            '          "parameters": {\n' +
            '            "type": "object",\n' +
            '            "properties": {\n' +
            '              "location": {"type": "string", "description": "City name"}\n' +
            '            },\n' +
            '            "required": ["location"]\n' +
            '          }\n' +
            '        }\n' +
            '      }\n' +
            '    ]\n' +
            '  }\'',
            'python',
            'response = client.chat.completions.create(\n' +
            '    model="openmake_llm_pro",\n' +
            '    messages=[\n' +
            '        {"role": "user", "content": "What is the weather in Seoul?"}\n' +
            '    ],\n' +
            '    tools=[{\n' +
            '        "type": "function",\n' +
            '        "function": {\n' +
            '            "name": "get_weather",\n' +
            '            "description": "Get current weather for a location",\n' +
            '            "parameters": {\n' +
            '                "type": "object",\n' +
            '                "properties": {\n' +
            '                    "location": {"type": "string", "description": "City name"}\n' +
            '                },\n' +
            '                "required": ["location"]\n' +
            '            }\n' +
            '        }\n' +
            '    }]\n' +
            ')\n\n' +
            '# Check for tool calls\n' +
            'tool_calls = response.choices[0].message.tool_calls\n' +
            'if tool_calls:\n' +
            '    print(tool_calls[0].function.name)       # "get_weather"\n' +
            '    print(tool_calls[0].function.arguments)  # {"location": "Seoul"}',
            'typescript',
            'const response = await client.chat.completions.create({\n' +
            '  model: "openmake_llm_pro",\n' +
            '  messages: [\n' +
            '    { role: "user", content: "What is the weather in Seoul?" }\n' +
            '  ],\n' +
            '  tools: [{\n' +
            '    type: "function",\n' +
            '    function: {\n' +
            '      name: "get_weather",\n' +
            '      description: "Get current weather for a location",\n' +
            '      parameters: {\n' +
            '        type: "object",\n' +
            '        properties: {\n' +
            '          location: { type: "string", description: "City name" }\n' +
            '        },\n' +
            '        required: ["location"]\n' +
            '      }\n' +
            '    }\n' +
            '  }]\n' +
            '});\n\n' +
            '// Check for tool calls\n' +
            'const toolCalls = response.choices[0].message.tool_calls;\n' +
            'if (toolCalls) {\n' +
            '  console.log(toolCalls[0].function.name);       // "get_weather"\n' +
            '  console.log(toolCalls[0].function.arguments);  // {"location":"Seoul"}\n' +
            '}'
        ) +

        '<h3>Tool Call Response</h3>' +
        '<p>When the model decides to call a tool, <code>finish_reason</code> will be <code>"tool_calls"</code> and the message will include a <code>tool_calls</code> array:</p>' +
        getCodeBlock(
            'curl',
            '{\n' +
            '  "id": "chatcmpl-abc123...",\n' +
            '  "object": "chat.completion",\n' +
            '  "model": "openmake_llm_pro",\n' +
            '  "choices": [{\n' +
            '    "index": 0,\n' +
            '    "message": {\n' +
            '      "role": "assistant",\n' +
            '      "content": null,\n' +
            '      "tool_calls": [{\n' +
            '        "id": "call_abc123",\n' +
            '        "type": "function",\n' +
            '        "function": {\n' +
            '          "name": "get_weather",\n' +
            '          "arguments": "{\\"location\\": \\"Seoul\\"}"\n' +
            '        }\n' +
            '      }]\n' +
            '    },\n' +
            '    "finish_reason": "tool_calls"\n' +
            '  }]\n' +
            '}',
            'python',
            '# After receiving tool_calls, send the result back:\n' +
            'messages.append(response.choices[0].message)\n' +
            'messages.append({\n' +
            '    "role": "tool",\n' +
            '    "tool_call_id": "call_abc123",\n' +
            '    "content": "{"temp": "15C", "condition": "Sunny"}"\n' +
            '})\n\n' +
            '# Continue the conversation\n' +
            'final = client.chat.completions.create(\n' +
            '    model="openmake_llm_pro",\n' +
            '    messages=messages\n' +
            ')',
            'typescript',
            '// After receiving tool_calls, send the result back:\n' +
            'messages.push(response.choices[0].message);\n' +
            'messages.push({\n' +
            '  role: "tool",\n' +
            '  tool_call_id: "call_abc123",\n' +
            '  content: JSON.stringify({ temp: "15C", condition: "Sunny" })\n' +
            '});\n\n' +
            '// Continue the conversation\n' +
            'const final = await client.chat.completions.create({\n' +
            '  model: "openmake_llm_pro",\n' +
            '  messages\n' +
            '});'
        ) +

        // Models endpoint
        '<h3 id="openai-models">GET /models</h3>' +
        '<p><span class="endpoint-badge badge-get">GET</span> <code>/models</code></p>' +
        '<p>Lists all available models in OpenAI-compatible format.</p>' +

        getCodeBlock(
            'curl',
            'curl ' + window.location.origin + '/api/v1/models \\\n' +
            '  -H "Authorization: Bearer omk_live_sk_..."',
            'python',
            'models = client.models.list()\n' +
            'for model in models.data:\n' +
            '    print(model.id)',
            'typescript',
            'const models = await client.models.list();\n' +
            'for (const model of models.data) {\n' +
            '  console.log(model.id);\n' +
            '}'
        ) +

        '<h3>Response</h3>' +
        getCodeBlock(
            'curl',
            '{\n' +
            '  "object": "list",\n' +
            '  "data": [\n' +
            '    {\n' +
            '      "id": "openmake_llm",\n' +
            '      "object": "model",\n' +
            '      "created": 1709827200,\n' +
            '      "owned_by": "openmake",\n' +
            '      "name": "Default",\n' +
            '      "description": "Balanced general-purpose model"\n' +
            '    },\n' +
            '    {\n' +
            '      "id": "openmake_llm_pro",\n' +
            '      "object": "model",\n' +
            '      "created": 1709827200,\n' +
            '      "owned_by": "openmake"\n' +
            '    }\n' +
            '  ]\n' +
            '}',
            'python',
            '# models object\n' +
            'models.object    # "list"\n' +
            'models.data[0].id         # "openmake_llm"\n' +
            'models.data[0].owned_by   # "openmake"',
            'typescript',
            '// models object\n' +
            '{\n' +
            '  object: "list",\n' +
            '  data: [\n' +
            '    { id: "openmake_llm", object: "model", created: 1709827200, owned_by: "openmake" },\n' +
            '    { id: "openmake_llm_pro", object: "model", created: 1709827200, owned_by: "openmake" },\n' +
            '    // ...\n' +
            '  ]\n' +
            '}'
        ) +

        // Supported & Unsupported
        '<h3>Supported OpenAI Parameters</h3>' +
        '<table class="rate-table">' +
        '<thead><tr><th>Feature</th><th>Status</th><th>Notes</th></tr></thead>' +
        '<tbody>' +
        '<tr><td>Chat Completions</td><td style="color:var(--success);">Supported</td><td><code>POST /chat/completions</code></td></tr>' +
        '<tr><td>Streaming (SSE)</td><td style="color:var(--success);">Supported</td><td><code>stream: true</code></td></tr>' +
        '<tr><td>Tool/Function Calling</td><td style="color:var(--success);">Supported</td><td><code>tools</code>, <code>tool_choice</code></td></tr>' +
        '<tr><td>Model Listing</td><td style="color:var(--success);">Supported</td><td><code>GET /models</code></td></tr>' +
        '<tr><td>Temperature / Top-p / Stop</td><td style="color:var(--success);">Supported</td><td>Standard sampling parameters</td></tr>' +
        '<tr><td>Text Completions</td><td style="color:var(--text-muted);">Not Available</td><td><code>POST /completions</code> &mdash; use Chat Completions instead</td></tr>' +
        '<tr><td>Embeddings</td><td style="color:var(--text-muted);">Not Available</td><td><code>POST /embeddings</code></td></tr>' +
        '<tr><td>Image Generation</td><td style="color:var(--text-muted);">Not Available</td><td>&mdash;</td></tr>' +
        '</tbody></table>' +

        '</section>';
}

/**
 * 5. API Keys Management 섹션
 * @returns {string} HTML 문자열
 */
export function renderApiKeysSection() {
    return '<section id="apikeys" class="dev-section">' +
        '<h2>API Keys Management</h2>' +
        '<p>Programmatically manage your API keys. Useful for rotating keys or managing access for different services.</p>' +

        '<h3 id="create-key">Create Key</h3>' +
        '<p><span class="endpoint-badge badge-post">POST</span> <code>/api-keys</code></p>' +
        '<p>Create a new API key with optional name and expiration.</p>' +
        getCodeBlock(
            'curl',
            'curl -X POST ' + window.location.origin + '/api/api-keys \\\n' +
            '  -H "Authorization: Bearer <jwt_token>" \\\n' +
            '  -H "Content-Type: application/json" \\\n' +
            '  -d \'{"name": "New Service Key"}\'',
            'python',
            'requests.post("' + window.location.origin + '/api/api-keys", \n' +
            '    headers={"Authorization": "Bearer <jwt_token>"}, \n' +
            '    json={"name": "New Service Key"})',
            'typescript',
            'await fetch("' + window.location.origin + '/api/api-keys", {\n' +
            '  method: "POST",\n' +
            '  headers: {"Authorization": "Bearer <jwt_token>", "Content-Type": "application/json"},\n' +
            '  body: JSON.stringify({name: "New Service Key"})\n' +
            '})'
        ) +
        '<h3 id="list-keys" style="margin-top:60px;">List Keys</h3>' +
        '<p><span class="endpoint-badge badge-get">GET</span> <code>/api-keys</code></p>' +
        '<p>Returns a list of all API keys for the current account.</p>' +
        getCodeBlock(
            'curl',
            'curl ' + window.location.origin + '/api/api-keys \\\n  -H "Authorization: Bearer <jwt_token>"',
            'python', 'requests.get("' + window.location.origin + '/api/api-keys", headers={"Authorization": "Bearer <jwt_token>"})',
            'typescript', 'fetch("' + window.location.origin + '/api/api-keys", {headers: {"Authorization": "Bearer <jwt_token>"}})'
        ) +

        '<h3 id="get-key" style="margin-top:60px;">Get Key Details</h3>' +
        '<p><span class="endpoint-badge badge-get">GET</span> <code>/api-keys/:id</code></p>' +
        '<p>Get metadata for a specific key (never returns the full secret key after creation).</p>' +
        getCodeBlock(
            'curl',
            'curl ' + window.location.origin + '/api/api-keys/<key_id> \\\n  -H "Authorization: Bearer <jwt_token>"',
            'python', 'requests.get("' + window.location.origin + '/api/api-keys/<key_id>", headers={"Authorization": "Bearer <jwt_token>"})',
            'typescript', 'fetch("' + window.location.origin + '/api/api-keys/<key_id>", {\n  headers: { "Authorization": "Bearer <jwt_token>" }\n})'
        ) +

        '<h3 id="update-key" style="margin-top:60px;">Update Key</h3>' +
        '<p><span class="endpoint-badge badge-patch">PATCH</span> <code>/api-keys/:id</code></p>' +
        '<p>Update key metadata such as name, description, scopes, allowed models, rate limit tier, or active status.</p>' +
        getCodeBlock(
            'curl',
            'curl -X PATCH ' + window.location.origin + '/api/api-keys/<key_id> \\\n' +
            '  -H "Authorization: Bearer <jwt_token>" \\\n' +
            '  -H "Content-Type: application/json" \\\n' +
            '  -d \'{"name": "Updated Name", "rate_limit_tier": "standard"}\'',
            'python',
            'requests.patch("' + window.location.origin + '/api/api-keys/<key_id>",\n' +
            '    headers={"Authorization": "Bearer <jwt_token>"},\n' +
            '    json={"name": "Updated Name", "rate_limit_tier": "standard"})',
            'typescript',
            'await fetch("' + window.location.origin + '/api/api-keys/<key_id>", {\n' +
            '  method: "PATCH",\n' +
            '  headers: {"Authorization": "Bearer <jwt_token>", "Content-Type": "application/json"},\n' +
            '  body: JSON.stringify({name: "Updated Name", rate_limit_tier: "standard"})\n' +
            '})'
        ) +
        '<h4>Request Body Parameters</h4>' +
        '<table class="dev-table"><thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead><tbody>' +
        '<tr><td><code>name</code></td><td>string</td><td>Key name (1-100 chars)</td></tr>' +
        '<tr><td><code>description</code></td><td>string</td><td>Key description (max 500 chars)</td></tr>' +
        '<tr><td><code>scopes</code></td><td>string[]</td><td>Access scopes</td></tr>' +
        '<tr><td><code>allowed_models</code></td><td>string[]</td><td>Allowed model names</td></tr>' +
        '<tr><td><code>rate_limit_tier</code></td><td>string</td><td>One of: free, starter, standard, enterprise</td></tr>' +
        '<tr><td><code>is_active</code></td><td>boolean</td><td>Enable or disable the key</td></tr>' +
        '<tr><td><code>expires_at</code></td><td>string|null</td><td>ISO 8601 datetime or null for no expiry</td></tr>' +
        '</tbody></table>' +

        '<h3 id="delete-key" style="margin-top:60px;">Delete Key</h3>' +
        '<p><span class="endpoint-badge badge-delete">DELETE</span> <code>/api-keys/:id</code></p>' +
        '<p>Permanently deletes an API key. This action cannot be undone.</p>' +
        getCodeBlock(
            'curl',
            'curl -X DELETE ' + window.location.origin + '/api/api-keys/<key_id> \\\n  -H "Authorization: Bearer <jwt_token>"',
            'python', 'requests.delete("' + window.location.origin + '/api/api-keys/<key_id>", headers={"Authorization": "Bearer <jwt_token>"})',
            'typescript', 'await fetch("' + window.location.origin + '/api/api-keys/<key_id>", {\n  method: "DELETE",\n  headers: { "Authorization": "Bearer <jwt_token>" }\n})'
        ) +

        '<h3 style="margin-top:60px;">Rotate Key</h3>' +
        '<p><span class="endpoint-badge badge-post">POST</span> <code>/api-keys/:id/rotate</code></p>' +
        '<p>Invalidates the old key immediately and returns a new secret key.</p>' +
        getCodeBlock(
            'curl',
            'curl -X POST ' + window.location.origin + '/api/api-keys/<key_id>/rotate \\\n  -H "Authorization: Bearer <jwt_token>"',
            'python', 'requests.post("' + window.location.origin + '/api/api-keys/<key_id>/rotate", headers={"Authorization": "Bearer <jwt_token>"})',
            'typescript', 'await fetch("' + window.location.origin + '/api/api-keys/<key_id>/rotate", {\n  method: "POST",\n  headers: { "Authorization": "Bearer <jwt_token>" }\n})'
        ) +

        '<h3 id="key-usage" style="margin-top:60px;">Key Usage Stats</h3>' +
        '<p><span class="endpoint-badge badge-get">GET</span> <code>/api-keys/:id/usage</code></p>' +
        '<p>Get usage statistics for a specific API key including total requests, tokens consumed, and last used timestamp.</p>' +
        getCodeBlock(
            'curl',
            'curl ' + window.location.origin + '/api/api-keys/<key_id>/usage \\\n  -H "Authorization: Bearer <jwt_token>"',
            'python', 'requests.get("' + window.location.origin + '/api/api-keys/<key_id>/usage", headers={"Authorization": "Bearer <jwt_token>"})',
            'typescript', 'fetch("' + window.location.origin + '/api/api-keys/<key_id>/usage", {\n  headers: { "Authorization": "Bearer <jwt_token>" }\n})'
        ) +
        '<h4>Response Example</h4>' +
        '<pre><code class="language-json">{\n' +
        '  "success": true,\n' +
        '  "data": {\n' +
        '    "usage": {\n' +
        '      "total_requests": 1542,\n' +
        '      "total_tokens": 285400,\n' +
        '      "last_used_at": "2025-03-07T10:30:00Z"\n' +
        '    }\n' +
        '  }\n' +
        '}</code></pre>' +
        '</section>';
}

/**
 * 6. Usage & Billing 섹션
 * @returns {string} HTML 문자열
 */
export function renderUsageSection() {
    return '<section id="usage" class="dev-section">' +
        '<h2>Usage & Billing</h2>' +
        '<p><span class="endpoint-badge badge-get">GET</span> <code>/usage</code></p>' +
        '<p>Get current usage statistics for the billing period.</p>' +
        getCodeBlock(
            'curl',
            'curl ' + window.location.origin + '/api/v1/usage \\\n  -H "X-API-Key: omk_live_sk_..."',
            'python', 'requests.get("' + window.location.origin + '/api/v1/usage", headers={"X-API-Key": "omk_live_sk_..."})',
            'typescript', 'fetch("' + window.location.origin + '/api/v1/usage", {\n  headers: { "X-API-Key": "omk_live_sk_..." }\n})'
        ) +

        '<h3>Response</h3>' +
        getCodeBlock(
            'curl',
            '{\n' +
            '  "success": true,\n' +
            '  "data": {\n' +
            '    "usage": {\n' +
            '      "total_requests": 1234,\n' +
            '      "total_tokens": 567890,\n' +
            '      "last_used_at": "2026-03-07T12:00:00.000Z"\n' +
            '    },\n' +
            '    "limits": {\n' +
            '      "tier": "free"\n' +
            '    }\n' +
            '  }\n' +
            '}',
            'python',
            '# response.json()\n' +
            '{\n' +
            '  "success": true,\n' +
            '  "data": {\n' +
            '    "usage": { "total_requests": 1234, "total_tokens": 567890, ... },\n' +
            '    "limits": { "tier": "free" }\n' +
            '  }\n' +
            '}',
            'typescript',
            '// response data\n' +
            '{\n' +
            '  success: true,\n' +
            '  data: {\n' +
            '    usage: { total_requests: 1234, total_tokens: 567890, last_used_at: "..." },\n' +
            '    limits: { tier: "free" }\n' +
            '  }\n' +
            '}'
        ) +

        '<h3>Daily Usage</h3>' +
        '<p><span class="endpoint-badge badge-get">GET</span> <code>/usage/daily?days=7</code></p>' +
        '<p>Get daily usage breakdown. The <code>days</code> query parameter controls the lookback period (default: 7).</p>' +
        getCodeBlock(
            'curl',
            'curl "' + window.location.origin + '/api/v1/usage/daily?days=7" \\\n  -H "X-API-Key: omk_live_sk_..."',
            'python', 'requests.get("' + window.location.origin + '/api/v1/usage/daily?days=7", headers={"X-API-Key": "omk_live_sk_..."})',
            'typescript', 'fetch("' + window.location.origin + '/api/v1/usage/daily?days=7", {\n  headers: { "X-API-Key": "omk_live_sk_..." }\n})'
        ) +
        '</section>';
}

/**
 * 7. Rate Limits 섹션
 * @returns {string} HTML 문자열
 */
export function renderRateLimitsSection() {
    return '<section id="rate-limits" class="dev-section">' +
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
}

/**
 * 8. Error Handling 섹션
 * @returns {string} HTML 문자열
 */
export function renderErrorsSection() {
    return '<section id="errors" class="dev-section">' +
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
}

/**
 * 9. SDKs & Libraries 섹션
 * @returns {string} HTML 문자열
 */
export function renderSdksSection() {
    return '<section id="sdks" class="dev-section">' +
        '<h2>SDKs & Libraries</h2>' +
        '<p>Official SDKs for Python and Node.js are coming soon. In the meantime, you can use any standard HTTP client to access the API.</p>' +
        '</section>';
}

export default {
    renderIntroSection, renderAuthSection, renderModelsSection,
    renderChatSection, renderOpenAICompatSection, renderApiKeysSection,
    renderUsageSection, renderRateLimitsSection, renderErrorsSection, renderSdksSection
};
