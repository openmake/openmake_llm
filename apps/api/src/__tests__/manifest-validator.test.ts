import { parseSkillFile, validateManifest } from '../agents/manifest-validator';

const VALID_SKILL = `---
name: code-reviewer
description: 코드 리뷰 전문 skill
category: engineering
version: 1.0.0
tool_bindings:
  - tool_name: web_search
    mode: allowed
  - tool_name: fs_read_file
    mode: required
---

# Code Reviewer

당신은 코드 리뷰 전문가입니다. 다음 원칙에 따라 리뷰하세요:
- 가독성
- 성능
- 보안
`;

describe('parseSkillFile', () => {
    test('frontmatter + body 분리', () => {
        const parsed = parseSkillFile(VALID_SKILL);
        expect(parsed.frontmatter.name).toBe('code-reviewer');
        expect(parsed.prompt_md).toContain('Code Reviewer');
        expect(parsed.prompt_md.startsWith('---')).toBe(false);
    });

    test('frontmatter 없는 입력은 거부', () => {
        expect(() => parseSkillFile('# just markdown')).toThrow(/frontmatter/i);
    });

    test('잘못된 YAML 거부', () => {
        const bad = `---\nname: [unclosed\n---\nbody content`;
        expect(() => parseSkillFile(bad)).toThrow();
    });
});

describe('validateManifest', () => {
    test('valid manifest 통과', async () => {
        const parsed = parseSkillFile(VALID_SKILL);
        const result = await validateManifest(parsed, {
            availableToolNames: new Set(['web_search', 'fs_read_file', 'deep_research']),
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.manifest.tool_bindings).toHaveLength(2);
            expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
        }
    });

    test('존재하지 않는 도구는 거부', async () => {
        const parsed = parseSkillFile(VALID_SKILL);
        const result = await validateManifest(parsed, {
            availableToolNames: new Set(['web_search']),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.some(e => e.includes('fs_read_file'))).toBe(true);
        }
    });

    test('checksum 은 prompt_md 의 sha256', async () => {
        const parsed = parseSkillFile(VALID_SKILL);
        const result = await validateManifest(parsed, {
            availableToolNames: new Set(['web_search', 'fs_read_file']),
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            const expected = require('crypto').createHash('sha256').update(parsed.prompt_md).digest('hex');
            expect(result.checksum).toBe(expected);
        }
    });

    test('필수 필드 누락 거부', async () => {
        const bad = `---\nname: foo\n---\nbody content here is long enough`;
        const parsed = parseSkillFile(bad);
        const result = await validateManifest(parsed, { availableToolNames: new Set() });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.some(e => /description/.test(e))).toBe(true);
            expect(result.errors.some(e => /category/.test(e))).toBe(true);
        }
    });
});
