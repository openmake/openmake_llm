const fs = require('fs');
const path = require('path');
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend', 'web', 'public');
const PAGES_DIR = path.join(PUBLIC_DIR, 'js', 'modules', 'pages');
if (!fs.existsSync(PAGES_DIR)) fs.mkdirSync(PAGES_DIR, { recursive: true });

const PAGES = [
    'canvas', 'mcp-tools',
    'marketplace', 'custom-agents', 'agent-learning',
    'cluster', 'usage', 'analytics', 'admin-metrics',
    'admin', 'audit', 'external', 'alerts', 'memory',
    'settings', 'password-change', 'history'
];
// NOTE: 'research' and 'guide' are manually authored — do NOT include here

// Global functions provided by sidebar.js/ui.js — no need to expose on window
const GLOBAL_FNS = new Set([
    'toggleMobileSidebar', 'toggleSidebar', 'toggleTheme',
    'loginWithGoogle', 'loginWithGitHub', 'continueAsGuest'
]);

/**
 * Find matching closing tag for a div, counting nested divs.
 */
function findMatchingDivClose(html, startIdx) {
    let depth = 1;
    let i = startIdx;
    while (i < html.length && depth > 0) {
        const openMatch = html.indexOf('<div', i);
        const closeMatch = html.indexOf('</div>', i);

        if (closeMatch === -1) break;

        if (openMatch !== -1 && openMatch < closeMatch) {
            // Check it's actually a div tag (not <divider etc.)
            const charAfter = html[openMatch + 4];
            if (charAfter === ' ' || charAfter === '>' || charAfter === '\n' || charAfter === '\t' || charAfter === '\r') {
                depth++;
            }
            i = openMatch + 4;
        } else {
            depth--;
            if (depth === 0) return closeMatch;
            i = closeMatch + 6;
        }
    }
    return -1;
}

function extractSections(html) {
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    const styleContent = styleMatch ? styleMatch[1].trim() : '';

    let mainContent = '';

    // Try <main class="main-content"> first
    const mainTagMatch = html.match(/<main\s+class="main-content">([\s\S]*?)<\/main>/);
    if (mainTagMatch) {
        mainContent = mainTagMatch[1].trim();
    } else {
        // Try <div class="main-content">
        const divMainIdx = html.indexOf('<div class="main-content">');
        if (divMainIdx !== -1) {
            const contentStart = divMainIdx + '<div class="main-content">'.length;
            const contentEnd = findMatchingDivClose(html, contentStart);
            if (contentEnd !== -1) {
                mainContent = html.substring(contentStart, contentEnd).trim();
            }
        }
    }

    // Grab modal overlays after main content section
    const mainEndMarker = mainContent ? '</main>' : '</div>';
    const mainEndIdx = html.indexOf(mainContent) + mainContent.length;
    const afterMain = html.substring(mainEndIdx);

    const modalParts = [];
    const modalRe = /(<div\s+class="modal-overlay"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>)/g;
    let m;
    while ((m = modalRe.exec(afterMain)) !== null) modalParts.push(m[1]);

    // Also grab standalone toast divs
    const toastMatch = afterMain.match(/<div\s+id="toast"[^>]*><\/div>/);
    const toastHTML = toastMatch ? toastMatch[0] : '<div id="toast" class="toast"></div>';

    // Extract script content
    const scripts = [];
    const scriptRe = /<script(?:\s[^>]*)?>(?!\s*<\/)([\s\S]*?)<\/script>/g;
    while ((m = scriptRe.exec(html)) !== null) {
        const tag = m[0];
        if (tag.includes('src=')) continue;
        const content = m[1].trim();
        if (!content) continue;
        if (content.includes('window.location.href') && content.length < 200) continue;
        if (content.includes('SharedSidebar') || content.includes('new SharedSidebar')) continue;
        if (content.includes('NAV_ITEMS') && content.includes('pageNavMenu')) continue;
        scripts.push(content);
    }

    const allHTML = mainContent + '\n' + modalParts.join('\n') + '\n' + toastHTML;
    return { styleContent, mainHTML: allHTML, scriptContent: scripts.join('\n\n') };
}

/**
 * Extract onclick="funcName(...)" function names from HTML.
 * Returns unique function names that are NOT already global.
 */
function extractOnclickFunctions(htmlContent) {
    const re = /onclick="([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    const fns = new Set();
    let m;
    while ((m = re.exec(htmlContent)) !== null) {
        const fn = m[1];
        if (!GLOBAL_FNS.has(fn)) fns.add(fn);
    }
    return Array.from(fns);
}

function generateModule(pageName) {
    const htmlFile = path.join(PUBLIC_DIR, pageName + '.html');
    if (!fs.existsSync(htmlFile)) { console.log('  SKIP (not found)'); return null; }
    const html = fs.readFileSync(htmlFile, 'utf-8');

    // Redirect pages
    if (html.includes('window.location.href') && html.length < 500 && !html.includes('<main')) {
        console.log('  SKIP (redirect page)');
        return null;
    }

    const { styleContent, mainHTML, scriptContent } = extractSections(html);

    if (!mainHTML || mainHTML.trim().length < 50) {
        console.log('  WARNING: very little HTML extracted (' + mainHTML.trim().length + ' chars)');
    }

    const cssStr = JSON.stringify(styleContent);
    const htmlStr = JSON.stringify(mainHTML);

    // Process script: wrap setInterval + SPA-safe transforms
    let processedScript = scriptContent;
    processedScript = processedScript.replace(
        /setInterval\s*\(/g,
        '(function(fn,ms){var id=setInterval(fn,ms);_intervals.push(id);return id})('
    );

    // SPA-safe: replace alert() with showToast() (non-blocking)
    processedScript = processedScript.replace(
        /\balert\s*\(([^)]*)\)/g,
        '(typeof showToast === \'function\' ? showToast($1, \'warning\') : console.warn($1))'
    );

    // SPA-safe: replace window.location.href with Router.navigate()
    // Uses expression form (short-circuit) to be safe inside arrow functions.
    // Preserves trailing semicolon if present (needed for statement contexts),
    // omits it if absent (arrow function expression contexts like setTimeout).
    processedScript = processedScript.replace(
        /window\.location\.href\s*=\s*['"]\/login\.html['"]\s*(;?)/g,
        function(match, semi) {
            return '(typeof Router !== \'undefined\' && Router.navigate(\'/\'))' + semi;
        }
    );

    processedScript = processedScript.replace(
        /window\.location\.href\s*=\s*['"]\/((?!login)[^'"]*)['"]\s*(;?)/g,
        function(match, path, semi) {
            return '(typeof Router !== \'undefined\' && Router.navigate(\'/' + path + '\'))' + semi;
        }
    );

    processedScript = processedScript.replace(
        /window\.location\.href\s*=\s*`\/\?([^`]*)`\s*(;?)/g,
        function(match, tpl, semi) {
            return '(typeof Router !== \'undefined\' && Router.navigate(\'/?\' + `' + tpl + '`))' + semi;
        }
    );

    // Extract onclick function names from full HTML
    const onclickFns = extractOnclickFunctions(html);

    // Build window exposure lines
    let windowExpose = '';
    let windowCleanup = '';
    if (onclickFns.length > 0) {
        const exposeLines = onclickFns.map(fn =>
            '                if (typeof ' + fn + ' === \'function\') window.' + fn + ' = ' + fn + ';'
        ).join('\n');
        windowExpose = '\n            // Expose onclick-referenced functions globally\n' + exposeLines;

        const cleanupLines = onclickFns.map(fn =>
            '                try { delete window.' + fn + '; } catch(e) {}'
        ).join('\n');
        windowCleanup = '\n            // Remove onclick-exposed globals\n' + cleanupLines;
    }

    const module = '/**\n' +
' * ' + pageName + ' - SPA Page Module\n' +
' * Auto-generated from ' + pageName + '.html\n' +
' */\n' +
'(function() {\n' +
'    \'use strict\';\n' +
'    window.PageModules = window.PageModules || {};\n' +
'    var _intervals = [];\n' +
'    var _timeouts = [];\n' +
'\n' +
'    window.PageModules[\'' + pageName + '\'] = {\n' +
'        getHTML: function() {\n' +
'            return \'<div class="page-' + pageName + '">\' +\n' +
'                \'<style data-spa-style="' + pageName + '">\' +\n' +
'                ' + cssStr + ' +\n' +
'                \'<\\/style>\' +\n' +
'                ' + htmlStr + ' +\n' +
'            \'<\\/div>\';\n' +
'        },\n' +
'\n' +
'        init: function() {\n' +
'            try {\n' +
'                ' + processedScript + '\n' +
windowExpose + '\n' +
'            } catch(e) {\n' +
'                console.error(\'[PageModule:' + pageName + '] init error:\', e);\n' +
'            }\n' +
'        },\n' +
'\n' +
'        cleanup: function() {\n' +
'            _intervals.forEach(function(id) { clearInterval(id); });\n' +
'            _intervals = [];\n' +
'            _timeouts.forEach(function(id) { clearTimeout(id); });\n' +
'            _timeouts = [];' + windowCleanup + '\n' +
'        }\n' +
'    };\n' +
'})();\n';

    return module;
}

// Run
console.log('=== SPA Module Generator v3 ===');
console.log('Skipping manually-authored: research, guide');
let created = 0, skipped = 0;
PAGES.forEach(function(name) {
    process.stdout.write(name + ': ');
    const mod = generateModule(name);
    if (mod) {
        fs.writeFileSync(path.join(PAGES_DIR, name + '.js'), mod);
        console.log('OK (' + mod.length + ' bytes)');
        created++;
    } else {
        skipped++;
    }
});
console.log('\nCreated: ' + created + ', Skipped: ' + skipped);
console.log('Remember: research.js and guide.js are not regenerated (manually authored).');
