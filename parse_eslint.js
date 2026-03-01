const fs = require('fs');

const map = JSON.parse(fs.readFileSync('tmp_scripts/map.json', 'utf8'));
const eslintResults = JSON.parse(fs.readFileSync('eslint_results.json', 'utf8'));

const finalResults = [];

eslintResults.forEach(res => {
    const filename = res.filePath.split('/').pop();
    const mapping = map.find(m => m.filename === `tmp_scripts/${filename}`);
    if (!mapping) return;

    const undefinedVars = new Set();
    res.messages.forEach(msg => {
        if (msg.ruleId === 'no-undef') {
            const match = msg.message.match(/'([^']+)' is not defined/);
            if (match) undefinedVars.add(match[1]);
        }
    });

    // Also find top-level declarations
    const code = fs.readFileSync(res.filePath, 'utf8');
    const topLevelDecls = [];
    
    // Simple regex for top-level declarations
    const lines = code.split('\n');
    lines.forEach(line => {
        const varMatch = line.match(/^(?:var|let|const)\s+([a-zA-Z0-9_$]+)/);
        if (varMatch) topLevelDecls.push(`${line.match(/^(?:var|let|const)/)[0]} ${varMatch[1]}`);
        
        const fnMatch = line.match(/^function\s+([a-zA-Z0-9_$]+)/);
        if (fnMatch) topLevelDecls.push(`function ${fnMatch[1]}`);
        
        const classMatch = line.match(/^class\s+([a-zA-Z0-9_$]+)/);
        if (classMatch) topLevelDecls.push(`class ${classMatch[1]}`);
    });

    finalResults.push({
        file: mapping.file,
        lineNum: mapping.lineNum,
        undefinedVars: Array.from(undefinedVars),
        topLevelDecls
    });
});

console.log(JSON.stringify(finalResults, null, 2));
