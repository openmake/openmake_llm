const fs = require('fs');
const { execSync } = require('child_process');

const files = execSync('find frontend/web/public -name "*.html"').toString().trim().split('\n');

const results = [];
let scriptCounter = 0;

if (!fs.existsSync('tmp_scripts')) fs.mkdirSync('tmp_scripts');

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
                        if (inlineContent) saveScript(file, scriptStartLine, inlineContent);
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
                    if (fullScript) saveScript(file, scriptStartLine, fullScript);
                }
                scriptContent = [];
            } else {
                scriptContent.push(line);
            }
        }
    }
});

function saveScript(file, lineNum, code) {
    const filename = `tmp_scripts/script_${scriptCounter++}.js`;
    fs.writeFileSync(filename, code);
    results.push({ file, lineNum, filename });
}

fs.writeFileSync('tmp_scripts/map.json', JSON.stringify(results, null, 2));
