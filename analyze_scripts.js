const fs = require('fs');
const { execSync } = require('child_process');
const acorn = require('acorn');

const files = execSync('find frontend/web/public -name "*.html"').toString().trim().split('\n');

const results = [];

files.forEach(file => {
    if (!file) return;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    
    let inScript = false;
    let scriptStartLine = 0;
    let scriptContent = [];
    let hasSrc = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!inScript) {
            const match = line.match(/<script([^>]*)>/i);
            if (match) {
                inScript = true;
                scriptStartLine = i + 1;
                hasSrc = /src=/i.test(match[1]);
                
                const closeMatch = line.match(/<\/script>/i);
                if (closeMatch) {
                    inScript = false;
                    if (!hasSrc) {
                        const inlineContent = line.replace(/.*<script[^>]*>/i, '').replace(/<\/script>.*/i, '').trim();
                        if (inlineContent) analyzeScript(file, scriptStartLine, inlineContent);
                    }
                } else {
                    const inlineContent = line.replace(/.*<script[^>]*>/i, '').trim();
                    if (inlineContent) scriptContent.push(inlineContent);
                }
            }
        } else {
            const closeMatch = line.match(/<\/script>/i);
            if (closeMatch) {
                inScript = false;
                if (!hasSrc) {
                    const inlineContent = line.replace(/<\/script>.*/i, '').trim();
                    if (inlineContent) scriptContent.push(inlineContent);
                    
                    const fullScript = scriptContent.join('\n').trim();
                    if (fullScript) analyzeScript(file, scriptStartLine, fullScript);
                }
                scriptContent = [];
            } else {
                scriptContent.push(line);
            }
        }
    }
});

function analyzeScript(file, lineNum, code) {
    let ast;
    try {
        ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    } catch (e) {
        // Try module
        try {
            ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' });
        } catch (e2) {
            results.push({ file, lineNum, error: e.message });
            return;
        }
    }

    const topLevelDecls = [];
    const globals = new Set();
    const declared = new Set();

    // Simple walk to find top-level declarations
    ast.body.forEach(node => {
        if (node.type === 'VariableDeclaration') {
            node.declarations.forEach(decl => {
                if (decl.id.type === 'Identifier') {
                    topLevelDecls.push(`${node.kind} ${decl.id.name}`);
                    declared.add(decl.id.name);
                }
            });
        } else if (node.type === 'FunctionDeclaration') {
            if (node.id) {
                topLevelDecls.push(`function ${node.id.name}`);
                declared.add(node.id.name);
            }
        } else if (node.type === 'ClassDeclaration') {
            if (node.id) {
                topLevelDecls.push(`class ${node.id.name}`);
                declared.add(node.id.name);
            }
        }
    });

    // Simple walk to find global references (identifiers not declared)
    // This is a very basic walker, not perfect but good enough for common globals
    function walk(node, scope) {
        if (!node) return;
        
        // Handle scope
        let newScope = new Set(scope);
        if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
            if (node.params) {
                node.params.forEach(p => {
                    if (p.type === 'Identifier') newScope.add(p.name);
                });
            }
            if (node.body) walk(node.body, newScope);
            return;
        }
        if (node.type === 'BlockStatement') {
            node.body.forEach(n => {
                if (n.type === 'VariableDeclaration') {
                    n.declarations.forEach(d => {
                        if (d.id.type === 'Identifier') newScope.add(d.id.name);
                    });
                }
            });
        }

        if (node.type === 'Identifier') {
            // Ignore property names
            if (!newScope.has(node.name) && !declared.has(node.name)) {
                globals.add(node.name);
            }
        }

        for (const key in node) {
            if (node[key] && typeof node[key] === 'object') {
                if (key === 'property' && node.type === 'MemberExpression' && !node.computed) continue;
                if (key === 'key' && node.type === 'Property' && !node.computed) continue;
                walk(node[key], newScope);
            }
        }
    }

    walk(ast, new Set());

    // Filter out common JS globals
    const commonGlobals = new Set(['window', 'document', 'console', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'URLSearchParams', 'Date', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'Promise', 'alert', 'confirm', 'location', 'history', 'navigator', 'Event', 'CustomEvent', 'FormData', 'Blob', 'File', 'FileReader', 'XMLHttpRequest', 'WebSocket', 'Worker', 'SharedWorker', 'ServiceWorker', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Reflect', 'Proxy', 'Intl', 'WebAssembly', 'console', 'undefined', 'NaN', 'Infinity', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape', 'eval', 'require', 'module', 'exports', 'process', 'global', 'Buffer', '__dirname', '__filename', 'URL', 'Headers', 'Request', 'Response', 'TextEncoder', 'TextDecoder', 'btoa', 'atob', 'crypto', 'performance', 'screen', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset', 'scroll', 'scrollTo', 'scrollBy', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'EventTarget', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'HTMLCollection', 'NodeList', 'DOMTokenList', 'DOMRect', 'DOMPoint', 'DOMMatrix', 'DOMException', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'PerformanceObserver', 'AbortController', 'AbortSignal', 'MessageChannel', 'MessagePort', 'BroadcastChannel', 'SharedArrayBuffer', 'Atomics', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'BigInt', 'globalThis', 'e', 'err', 'error', 'event', 'res', 'req', 'data', 'val', 'value', 'key', 'index', 'i', 'j', 'k', 'len', 'length', 'item', 'el', 'element', 'node', 'target', 'src', 'dest', 'obj', 'arr', 'str', 'num', 'bool', 'fn', 'cb', 'callback', 'resolve', 'reject', 'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Reflect', 'Proxy', 'Intl', 'WebAssembly', 'console', 'undefined', 'NaN', 'Infinity', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape', 'eval', 'require', 'module', 'exports', 'process', 'global', 'Buffer', '__dirname', '__filename', 'URL', 'Headers', 'Request', 'Response', 'TextEncoder', 'TextDecoder', 'btoa', 'atob', 'crypto', 'performance', 'screen', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset', 'scroll', 'scrollTo', 'scrollBy', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'EventTarget', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'HTMLCollection', 'NodeList', 'DOMTokenList', 'DOMRect', 'DOMPoint', 'DOMMatrix', 'DOMException', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'PerformanceObserver', 'AbortController', 'AbortSignal', 'MessageChannel', 'MessagePort', 'BroadcastChannel', 'SharedArrayBuffer', 'Atomics', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'BigInt', 'globalThis']);
    
    const customGlobals = Array.from(globals).filter(g => !commonGlobals.has(g));

    results.push({
        file,
        lineNum,
        topLevelDecls,
        customGlobals
    });
}

console.log(JSON.stringify(results, null, 2));
