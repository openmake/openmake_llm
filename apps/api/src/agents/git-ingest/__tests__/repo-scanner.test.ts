import { scanForSkillManifests } from '../repo-scanner';
import type { TreeEntry } from '../git-fetcher';

const tree = (paths: string[]): TreeEntry[] =>
    paths.map(p => ({ path: p, sha: 'x', size: 100, type: 'blob' as const }));

describe('scanForSkillManifests', () => {
    it('단일 root SKILL.md 후보 발견', () => {
        const r = scanForSkillManifests(tree(['README.md', 'SKILL.md', 'src/foo.ts']));
        expect(r).toHaveLength(1);
        expect(r[0].path).toBe('SKILL.md');
    });
    it('multi *.SKILL.md (대문자) + *.skill.md (소문자) 둘 다 감지', () => {
        const r = scanForSkillManifests(tree([
            'README.md', 'legal.SKILL.md', 'medical.skill.md', 'other.md', 'docs/api.md',
        ]));
        expect(r.map(c => c.path).sort()).toEqual(['legal.SKILL.md', 'medical.skill.md']);
    });
    it('skills/ 하위의 *.md 자동 후보 (관행)', () => {
        const r = scanForSkillManifests(tree([
            'skills/legal/SKILL.md', 'skills/medical/index.md', 'docs/foo.md',
        ]));
        expect(r.map(c => c.path).sort()).toEqual(['skills/legal/SKILL.md', 'skills/medical/index.md']);
    });
    it('지정 gitPath 가 있으면 그것만 선택 (자동 스캔 우회)', () => {
        const r = scanForSkillManifests(tree(['README.md', 'foo.txt', 'bar/baz.md']), 'bar/baz.md');
        expect(r).toHaveLength(1);
        expect(r[0].path).toBe('bar/baz.md');
    });
    it('명시 gitPath 가 tree 에 없으면 빈 배열 (caller 가 NO_SKILL_FOUND 처리)', () => {
        const r = scanForSkillManifests(tree(['README.md']), 'missing.md');
        expect(r).toEqual([]);
    });
    it('빈 tree → 빈 배열', () => {
        expect(scanForSkillManifests([])).toEqual([]);
    });
});

import { scanForAgentManifests } from '../repo-scanner';

describe('scanForAgentManifests', () => {
    it('root AGENT.md 후보 발견', () => {
        const r = scanForAgentManifests(tree(['README.md', 'AGENT.md', 'src/foo.ts']));
        expect(r).toHaveLength(1);
        expect(r[0].path).toBe('AGENT.md');
    });
    it('multi *.AGENT.md / *.agent.md 둘 다 감지', () => {
        const r = scanForAgentManifests(tree([
            'legal.AGENT.md', 'medical.agent.md', 'docs/foo.md',
        ]));
        expect(r.map(c => c.path).sort()).toEqual(['legal.AGENT.md', 'medical.agent.md']);
    });
    it('agents/ 하위의 *.md 자동 후보', () => {
        const r = scanForAgentManifests(tree([
            'agents/legal/AGENT.md', 'agents/medical/index.md', 'docs/foo.md',
        ]));
        expect(r.map(c => c.path).sort()).toEqual(['agents/legal/AGENT.md', 'agents/medical/index.md']);
    });
    it('explicitPath 우선', () => {
        const r = scanForAgentManifests(tree(['x.md']), 'x.md');
        expect(r).toHaveLength(1);
    });
});
