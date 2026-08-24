import {
    collectForeignFrontmatter,
    extractDeclaredTools,
    mapClaudeTools,
    detectBodyToolNames,
    detectBodyMarkers,
    buildCompatNote,
    adaptSkillContent,
} from '../skill-compat';

describe('skill-compat', () => {
    describe('collectForeignFrontmatter', () => {
        it('스키마가 인식하는 키는 제외하고 나머지만 보존', () => {
            const out = collectForeignFrontmatter({
                name: 'my-skill',
                description: 'desc',
                category: 'general',
                'allowed-tools': 'Read, Bash',
                model: 'claude-opus-4',
                'argument-hint': '<file>',
            });
            expect(Object.keys(out).sort()).toEqual(['allowed-tools', 'argument-hint', 'model']);
        });

        it('객체가 아니면 빈 객체', () => {
            expect(collectForeignFrontmatter(null)).toEqual({});
            expect(collectForeignFrontmatter('x')).toEqual({});
        });
    });

    describe('extractDeclaredTools', () => {
        it('콤마 문자열 형식', () => {
            expect(extractDeclaredTools({ 'allowed-tools': 'Read, Write, Bash' }))
                .toEqual(['Read', 'Write', 'Bash']);
        });

        it('배열 형식 + 인자 한정 표기에서 도구 이름만', () => {
            expect(extractDeclaredTools({ tools: ['Bash(git:*)', 'Glob'] }))
                .toEqual(['Bash', 'Glob']);
        });

        it('키가 없으면 빈 배열', () => {
            expect(extractDeclaredTools({ model: 'x' })).toEqual([]);
        });
    });

    describe('mapClaudeTools', () => {
        it('알려진 도구는 대응, 미지원은 to=null, 미지 이름은 제외', () => {
            expect(mapClaudeTools(['Read', 'NotebookEdit', 'web_search'])).toEqual([
                { from: 'Read', to: 'file_ops' },
                { from: 'NotebookEdit', to: null },
            ]);
        });
    });

    describe('detectBodyToolNames', () => {
        it('백틱/“tool” 접미만 감지 — 일반 영어 단어 오탐 없음', () => {
            expect(detectBodyToolNames('Use the `Bash` command and the Read tool.').sort())
                .toEqual(['Bash', 'Read']);
            // 평문 동사는 감지하지 않는다 (오탐이면 스킬 지침이 훼손된다)
            expect(detectBodyToolNames('Read the document and write a summary.')).toEqual([]);
        });
    });

    describe('detectBodyMarkers', () => {
        it('$ARGUMENTS · @$N · !`cmd` · @file · .claude/', () => {
            expect(detectBodyMarkers('/cmd $ARGUMENTS\nReview: @$1')).toEqual(['$ARGUMENTS', '@$N']);
            expect(detectBodyMarkers('run !`git status` first')).toEqual(['!`command`']);
            expect(detectBodyMarkers('see @docs/guide.md')).toEqual(['@file']);
            expect(detectBodyMarkers('read CLAUDE.md')).toEqual(['.claude/']);
        });

        it('관용구가 없으면 빈 배열', () => {
            expect(detectBodyMarkers('일반적인 스킬 본문입니다.')).toEqual([]);
        });
    });

    describe('buildCompatNote', () => {
        it('대응/미지원/자리표시자를 한 블록으로', () => {
            const note = buildCompatNote(
                [{ from: 'Bash', to: 'bash' }, { from: 'NotebookEdit', to: null }],
                ['$ARGUMENTS'],
            );
            expect(note).toContain('openmake 호환 안내');
            expect(note).toContain('`Bash` → `bash`');
            expect(note).toContain('대응 도구 없음');
            expect(note).toContain('$ARGUMENTS');
        });

        it('안내할 것이 없으면 빈 문자열', () => {
            expect(buildCompatNote([], [])).toBe('');
        });
    });

    describe('adaptSkillContent', () => {
        it('외부 스킬: 본문 앞에 안내 노트 prepend + 원문 보존', () => {
            const promptMd = 'Audit for accessibility: @$1\n\nUse the `Bash` tool to run checks.';
            const r = adaptSkillContent({
                frontmatter: { name: 'a11y', description: 'd', 'allowed-tools': 'Read, WebFetch' },
                promptMd,
            });
            expect(r.adapted).toBe(true);
            expect(r.content.startsWith('> **[openmake 호환 안내]**')).toBe(true);
            expect(r.content).toContain(promptMd);   // 원문은 재작성되지 않는다
            expect(r.compat?.toolMappings.map(m => m.from).sort()).toEqual(['Bash', 'Read', 'WebFetch']);
            expect(r.compat?.upstreamFrontmatter).toEqual({ 'allowed-tools': 'Read, WebFetch' });
            expect(r.notes.length).toBeGreaterThan(0);
        });

        it('이 환경 스킬(외부 표현 없음): 무변경', () => {
            const promptMd = '보고서를 작성할 때 다음 순서를 따르세요.\n1. 개요\n2. 본문';
            const r = adaptSkillContent({
                frontmatter: { name: 's', description: 'd', category: 'general' },
                promptMd,
            });
            expect(r.adapted).toBe(false);
            expect(r.content).toBe(promptMd);
            expect(r.compat).toBeNull();
        });

        it('안내할 관용구는 없고 보존할 frontmatter 만 있으면 본문 무변경 + 메타만', () => {
            const r = adaptSkillContent({
                frontmatter: { name: 's', description: 'd', license: 'MIT' },
                promptMd: '평범한 본문입니다.',
            });
            expect(r.adapted).toBe(true);
            expect(r.content).toBe('평범한 본문입니다.');
            expect(r.compat?.upstreamFrontmatter).toEqual({ license: 'MIT' });
        });
    });
});
