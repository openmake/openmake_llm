import { parseAgentFile, validateAgentManifest } from '../agent-manifest-validator';

const validAgent = `---
type: agent
name: Legal Advisor
description: 한국 법률 자문 전문가
category: legal
emoji: '⚖️'
keywords:
  - 법률
  - 변호사
temperature: 0.3
max_tokens: 4000
skill_bindings:
  - skill-id:user-skill-abc123
  - git-url:https://github.com/foo/legal/SKILL.md
version: '1.0.0'
---

You are a legal advisor.`;

describe('parseAgentFile', () => {
    it('frontmatter + body 분리', () => {
        const r = parseAgentFile(validAgent);
        expect((r.frontmatter as { name: string }).name).toBe('Legal Advisor');
        expect(r.system_prompt).toContain('You are a legal advisor');
    });
    it('frontmatter 없으면 throw', () => {
        expect(() => parseAgentFile('# No frontmatter')).toThrow(/frontmatter/);
    });
});

describe('validateAgentManifest', () => {
    it('valid agent → ok:true', async () => {
        const parsed = parseAgentFile(validAgent);
        const r = await validateAgentManifest(parsed);
        if (!r.ok) throw new Error(`expected ok, got errors: ${r.errors.join(',')}`);
        expect(r.manifest.name).toBe('Legal Advisor');
        expect(r.manifest.skill_bindings).toHaveLength(2);
    });
    it('type != agent → INVALID_AGENT_TYPE', async () => {
        const bad = validAgent.replace('type: agent', 'type: skill');
        const parsed = parseAgentFile(bad);
        const r = await validateAgentManifest(parsed);
        if (r.ok) throw new Error('expected fail');
        expect(r.errors[0]).toContain('type');
    });
    it('필수 필드 누락 (name) → errors', async () => {
        const bad = validAgent.replace('name: Legal Advisor', 'name: ""');
        const parsed = parseAgentFile(bad);
        const r = await validateAgentManifest(parsed);
        if (r.ok) throw new Error('expected fail');
        expect(r.errors.some(e => e.includes('name'))).toBe(true);
    });
    it('system_prompt 너무 짧음 → errors', async () => {
        const bad = validAgent.replace('You are a legal advisor.', 'short');
        const parsed = parseAgentFile(bad);
        const r = await validateAgentManifest(parsed);
        if (r.ok) throw new Error('expected fail');
        expect(r.errors.some(e => e.includes('system_prompt'))).toBe(true);
    });
    it('skill_bindings reference 형식 검증 (skill-id: 또는 git-url:)', async () => {
        const bad = validAgent.replace('skill-id:user-skill-abc123', 'invalid:foo');
        const parsed = parseAgentFile(bad);
        const r = await validateAgentManifest(parsed);
        if (r.ok) throw new Error('expected fail');
        expect(r.errors.some(e => e.includes('skill_bindings'))).toBe(true);
    });
});
