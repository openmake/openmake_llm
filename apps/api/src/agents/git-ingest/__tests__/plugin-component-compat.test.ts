import {
    splitFrontmatter,
    componentNameFromPath,
    deriveDescription,
    commandFileToSkillMarkdown,
    agentFileToCustomAgent,
} from '../plugin-component-compat';
import { extensionOf, isStorableAsset, assetContentType } from '../extension-components';

describe('plugin-component-compat', () => {
    describe('splitFrontmatter', () => {
        it('프론트매터 + 본문 분리', () => {
            const r = splitFrontmatter('---\ndescription: d\n---\n\n# Title\nbody');
            expect(r.frontmatter).toEqual({ description: 'd' });
            expect(r.body).toBe('# Title\nbody');
        });

        it('프론트매터 없으면 전체가 본문', () => {
            const r = splitFrontmatter('just body');
            expect(r).toEqual({ frontmatter: {}, body: 'just body' });
        });

        it('YAML 파싱 실패도 관용 (전체를 본문 취급)', () => {
            const r = splitFrontmatter('---\n\tbad:\t: yaml:\n---\nbody');
            expect(r.frontmatter).toEqual({});
        });
    });

    describe('componentNameFromPath', () => {
        it('경로 → 파일명(확장자 제거)', () => {
            expect(componentNameFromPath('plugins/x/commands/new-sdk-app.md')).toBe('new-sdk-app');
            expect(componentNameFromPath('agents/reviewer.md')).toBe('reviewer');
        });
    });

    describe('deriveDescription', () => {
        it('헤딩·인용을 건너뛴 첫 문단', () => {
            expect(deriveDescription('# Title\n\n> note\n\n실제 설명 문장입니다.', 'fb'))
                .toBe('실제 설명 문장입니다.');
        });

        it('본문이 비면 폴백', () => {
            expect(deriveDescription('# only heading', 'fb')).toBe('fb');
        });
    });

    describe('commandFileToSkillMarkdown', () => {
        it('name 없는 command → 파일명으로 보강, 원문 키 유지', () => {
            const raw = [
                '---',
                'description: Create and setup a new app',
                'argument-hint: "[project-name]"',
                'allowed-tools: Read, Edit, Glob',
                '---',
                '',
                'You are tasked with $ARGUMENTS.',
            ].join('\n');
            const r = commandFileToSkillMarkdown('plugins/p/commands/new-sdk-app.md', raw);
            expect(r.name).toBe('new-sdk-app');

            const parsed = splitFrontmatter(r.content);
            expect(parsed.frontmatter.name).toBe('new-sdk-app');
            expect(parsed.frontmatter.description).toBe('Create and setup a new app');
            // 원문 키는 유지 — 하류 skill-compat 이 보존·안내한다
            expect(parsed.frontmatter['argument-hint']).toBe('[project-name]');
            expect(parsed.frontmatter['allowed-tools']).toBe('Read, Edit, Glob');
            // 본문은 손대지 않는다
            expect(parsed.body).toBe('You are tasked with $ARGUMENTS.');
        });

        it('description 없으면 본문에서 유도', () => {
            const r = commandFileToSkillMarkdown('commands/audit.md', '---\nargument-hint: x\n---\n\n# Audit\n\n감사를 수행합니다.');
            expect(splitFrontmatter(r.content).frontmatter.description).toBe('감사를 수행합니다.');
        });

        it('프론트매터가 아예 없는 command 도 통과 가능한 형태로', () => {
            const r = commandFileToSkillMarkdown('commands/plain.md', '이 명령은 무언가를 합니다.');
            const fm = splitFrontmatter(r.content).frontmatter;
            expect(fm.name).toBe('plain');
            expect(fm.description).toBe('이 명령은 무언가를 합니다.');
        });
    });

    describe('agentFileToCustomAgent', () => {
        it('본문 = 시스템 프롬프트, 미사용 필드는 보존', () => {
            const raw = [
                '---',
                'name: agent-sdk-verifier-py',
                'description: Verify a Python Agent SDK app',
                'model: sonnet',
                'tools: Read, Glob, Bash',
                'color: purple',
                '---',
                '',
                'You are a Python Agent SDK application verifier.',
            ].join('\n');
            const r = agentFileToCustomAgent('plugins/p/agents/agent-sdk-verifier-py.md', raw);
            expect(r.name).toBe('agent-sdk-verifier-py');
            expect(r.description).toBe('Verify a Python Agent SDK app');
            expect(r.systemPrompt).toBe('You are a Python Agent SDK application verifier.');
            expect(r.upstreamFields).toEqual({ model: 'sonnet', tools: 'Read, Glob, Bash', color: 'purple' });
        });

        it('name 누락 시 파일명, description 누락 시 본문 유도', () => {
            const r = agentFileToCustomAgent('agents/reviewer.md', '당신은 코드 리뷰어입니다.');
            expect(r.name).toBe('reviewer');
            expect(r.description).toBe('당신은 코드 리뷰어입니다.');
            expect(r.upstreamFields).toEqual({});
        });
    });
});

// ── 번들 파일 저장 가능성 판별 (extension-components) ────────────────────────
describe('extension-components 번들 파일 판별', () => {
    it('확장자 추출', () => {
        expect(extensionOf('scripts/check.sh')).toBe('sh');
        expect(extensionOf('references/GUIDE.MD')).toBe('md');
        expect(extensionOf('assets/logo')).toBe('');
        expect(extensionOf('.hidden')).toBe('');
    });

    // fetcher 가 UTF-8 문자열만 주므로 바이너리는 저장 시 원본이 깨진다 (코드리뷰 지적)
    it('텍스트만 저장 가능 — 바이너리는 제외', () => {
        expect(isStorableAsset('scripts/run.py')).toBe(true);
        expect(isStorableAsset('references/rules.md')).toBe(true);
        expect(isStorableAsset('assets/diagram.svg')).toBe(true);
        expect(isStorableAsset('assets/logo.png')).toBe(false);
        expect(isStorableAsset('assets/manual.pdf')).toBe(false);
        expect(isStorableAsset('assets/font.woff2')).toBe(false);
        expect(isStorableAsset('assets/noext')).toBe(false);
    });

    it('content_type 매핑 (미지 확장자는 text/plain)', () => {
        expect(assetContentType('references/a.md')).toBe('text/markdown');
        expect(assetContentType('scripts/a.sh')).toBe('text/x-shellscript');
        expect(assetContentType('data/a.json')).toBe('application/json');
        expect(assetContentType('notes/a.rst')).toBe('text/plain');
    });
});
