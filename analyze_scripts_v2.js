const fs = require('fs');
const { execSync } = require('child_process');
const acorn = require('acorn');
const walk = require('acorn-walk');

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
        try {
            ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' });
        } catch (e2) {
            results.push({ file, lineNum, error: e.message });
            return;
        }
    }

    const topLevelDecls = [];
    const declared = new Set();

    // Find top-level declarations
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

    // Find all identifiers and their scopes
    const globals = new Set();
    const scopes = [new Set(declared)];

    walk.ancestor(ast, {
        Identifier(node, ancestors) {
            const parent = ancestors[ancestors.length - 2];
            
            // Ignore property names in member expressions and object literals
            if (parent) {
                if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
                if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
                if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return;
                if (parent.type === 'LabeledStatement' && parent.label === node) return;
                if (parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return;
            }

            // Check if it's declared in any scope
            const name = node.name;
            let isDeclared = false;
            
            // We need a proper scope analyzer, but for now we can just check if it's in the top-level declared set
            // Wait, we need to handle local variables and function parameters.
            // Let's just use a simple heuristic: if it's not in top-level declared, and not a common global, we flag it.
            // But we'll get false positives for local variables.
        }
    });
    
    // Actually, writing a full scope analyzer is hard. Let's just use regex to find external script tags in the same file to see what globals they might provide.
}
