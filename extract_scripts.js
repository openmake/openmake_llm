const fs = require('fs');
const { execSync } = require('child_process');

const files = execSync('find frontend/web/public -name "*.html"').toString().trim().split('\n');

files.forEach(file => {
    if (!file) return;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    
    let inScript = false;
    let scriptStartLine = 0;
    let scriptContent = [];
    let hasSrc = false;
    let scriptTag = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!inScript) {
            const match = line.match(/<script([^>]*)>/i);
            if (match) {
                inScript = true;
                scriptStartLine = i + 1;
                scriptTag = match[0];
                hasSrc = /src=/i.test(match[1]);
                
                // Check if it closes on the same line
                const closeMatch = line.match(/<\/script>/i);
                if (closeMatch) {
                    inScript = false;
                    if (!hasSrc) {
                        const inlineContent = line.replace(/.*<script[^>]*>/i, '').replace(/<\/script>.*/i, '').trim();
                        if (inlineContent) {
                            console.log(`\n--- ${file}:${scriptStartLine} ---`);
                            console.log(inlineContent);
                        }
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
                    if (fullScript) {
                        console.log(`\n--- ${file}:${scriptStartLine} ---`);
                        console.log(fullScript);
                    }
                }
                scriptContent = [];
            } else {
                scriptContent.push(line);
            }
        }
    }
});
