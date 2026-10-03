/**
 * skill_run 승인 결속 — 승인 때 본 절차와 실제 실행되는 절차가 같아야 한다.
 */
import { procedureChecksum, buildSkillRunPreview, bindSkillRunApproval, SKILL_RUN_CHECKSUM_ARG } from './skill-run-binding';

const spec = { kind: 'script' as const, lang: 'bash' as const, code: 'echo {{city}} && ls', params: ['city'] };

describe('procedureChecksum', () => {
    it('같은 절차는 키 순서와 무관하게 같은 값, 코드가 바뀌면 다른 값', () => {
        expect(procedureChecksum(spec)).toBe(procedureChecksum({ params: ['city'], code: 'echo {{city}} && ls', lang: 'bash', kind: 'script' }));
        expect(procedureChecksum(spec)).not.toBe(procedureChecksum({ ...spec, code: 'echo {{city}} && rm -rf /workspace' }));
    });
});

describe('buildSkillRunPreview', () => {
    it('스크립트는 언어와 코드 전문을, 브라우저는 액션과 허용 도메인을 보인다', () => {
        expect(buildSkillRunPreview(spec)).toContain('echo {{city}} && ls');
        expect(buildSkillRunPreview(spec)).toContain('bash');
        const b = buildSkillRunPreview({ kind: 'browser', actions: [{ action: 'goto', url: 'https://a.example' }], allowlist: ['a.example'] });
        expect(b).toContain('https://a.example');
        expect(b).toContain('a.example');
    });
});

describe('bindSkillRunApproval', () => {
    it('승인 전에 절차를 불러 인자에 체크섬을 묶고 미리보기를 돌려준다', async () => {
        const args: Record<string, unknown> = { skill_id: 's1' };
        const preview = await bindSkillRunApproval(args, async () => spec);
        expect(args[SKILL_RUN_CHECKSUM_ARG]).toBe(procedureChecksum(spec));
        expect(preview).toContain('echo {{city}} && ls');
    });

    it('모델이 넣은 체크섬 값은 덮어쓴다', async () => {
        const args: Record<string, unknown> = { skill_id: 's1', [SKILL_RUN_CHECKSUM_ARG]: 'forged' };
        await bindSkillRunApproval(args, async () => spec);
        expect(args[SKILL_RUN_CHECKSUM_ARG]).toBe(procedureChecksum(spec));
    });

    it('절차를 못 찾으면 체크섬을 지우고 미리보기 없이 진행한다(실행 단계가 "찾지 못함"으로 답한다)', async () => {
        const args: Record<string, unknown> = { skill_id: 'nope', [SKILL_RUN_CHECKSUM_ARG]: 'forged' };
        expect(await bindSkillRunApproval(args, async () => null)).toBeNull();
        expect(SKILL_RUN_CHECKSUM_ARG in args).toBe(false);
    });
});
