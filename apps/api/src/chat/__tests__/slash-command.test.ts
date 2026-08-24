import {
    substituteSkillArguments,
    parseSlashCommand,
    slugify,
    matchesSlug,
    buildAugmentedMessage,
    applySlashCommand,
    mergeActivatedSkillNames,
    type ApplySlashDeps,
} from '../slash-command';

describe('parseSlashCommand', () => {
    it('정상 명령 파싱', () => {
        expect(parseSlashCommand('/billing 환불 처리')).toEqual({ slug: 'billing', rest: '환불 처리' });
    });
    it('본문 없는 명령', () => {
        expect(parseSlashCommand('/legal')).toEqual({ slug: 'legal', rest: '' });
    });
    it('비슬래시 → null', () => {
        expect(parseSlashCommand('안녕하세요')).toBeNull();
        expect(parseSlashCommand('')).toBeNull();
    });
    it('대문자 slug 소문자화', () => {
        expect(parseSlashCommand('/Legal x')?.slug).toBe('legal');
    });
    it('"/path/to/x" 는 slug=path 로 파싱(매칭 단계에서 걸러짐)', () => {
        expect(parseSlashCommand('/path/to/x')).toEqual({ slug: 'path', rest: '/to/x' });
    });
});

describe('slugify / matchesSlug', () => {
    it('slugify', () => {
        expect(slugify('Korean Medical Law')).toBe('korean-medical-law');
    });
    it('matchesSlug: slug화 또는 소문자 일치', () => {
        expect(matchesSlug('Korean Medical Law', 'korean-medical-law')).toBe(true);
        expect(matchesSlug('billing', 'billing')).toBe(true);
        expect(matchesSlug('billing', 'legal')).toBe(false);
    });
});

describe('buildAugmentedMessage', () => {
    it('스킬 컨텍스트 + 본문 주입', () => {
        const out = buildAugmentedMessage({ name: 'Billing', content: 'rules here' }, '환불해줘');
        expect(out).toContain('스킬 "Billing" 적용');
        expect(out).toContain('<skill_context name="Billing">');
        expect(out).toContain('rules here');
        expect(out).toContain('환불해줘');
    });
    it('본문 없으면 기본 지시', () => {
        const out = buildAugmentedMessage({ name: 'X', content: 'c' }, '');
        expect(out).toContain('스킬 지침에 따라 진행');
    });
});

describe('substituteSkillArguments (외부 스킬 인자 자리표시자)', () => {
    it('$ARGUMENTS → 전체 인자', () => {
        const r = substituteSkillArguments('감사 대상: $ARGUMENTS', '로그인 화면 검토');
        expect(r).toEqual({ content: '감사 대상: 로그인 화면 검토', consumed: true });
    });

    it('$1/$2 → 공백 분리 토큰, @$1 은 @ 제거', () => {
        const r = substituteSkillArguments('리뷰: @$1 (기준 $2)', 'design.fig AA');
        expect(r.content).toBe('리뷰: design.fig (기준 AA)');
    });

    it('인자가 없으면 빈 문자열로 치환 (자리표시자 노출 방지)', () => {
        expect(substituteSkillArguments('대상: $ARGUMENTS', '').content).toBe('대상: ');
    });

    it('자리표시자가 없으면 원문 그대로 + consumed=false', () => {
        const r = substituteSkillArguments('평범한 본문', 'x');
        expect(r).toEqual({ content: '평범한 본문', consumed: false });
    });

    it('치환 텍스트의 $& 등 특수문자는 그대로 (replacer 함수)', () => {
        expect(substituteSkillArguments('q=$ARGUMENTS', 'a$&b').content).toBe('q=a$&b');
    });

    // 본문 산문의 금액·소수·여러자리 수는 자리표시자가 아니다 (코드리뷰 지적, 2026-08-24)
    it('금액·소수·여러 자리 수는 치환하지 않는다', () => {
        expect(substituteSkillArguments('the budget is $1,500', 'do X').content).toBe('the budget is $1,500');
        expect(substituteSkillArguments('costs $1.50 each', 'do X').content).toBe('costs $1.50 each');
        expect(substituteSkillArguments('about $19 total', 'do X').content).toBe('about $19 total');
    });

    it('금액만 있고 진짜 자리표시자가 없으면 consumed=false (원문 유지)', () => {
        expect(substituteSkillArguments('the budget is $1,500', 'x'))
            .toEqual({ content: 'the budget is $1,500', consumed: false });
    });

    it('자리표시자와 금액이 섞여 있으면 자리표시자만 치환', () => {
        const r = substituteSkillArguments('대상: $1 (예산 $1,500)', 'design.fig');
        expect(r.content).toBe('대상: design.fig (예산 $1,500)');
    });
});

describe('applySlashCommand', () => {
    it('비슬래시 → 원문 (findSkill 미호출)', async () => {
        const find = jest.fn();
        const out = await applySlashCommand('일반 질문입니다', { findSkillBySlug: find, enabled: true });
        expect(out).toBe('일반 질문입니다');
        expect(find).not.toHaveBeenCalled();
    });
    it('매칭 스킬 → 증강', async () => {
        const find = jest.fn().mockResolvedValue({ name: 'Billing', content: 'rules' });
        const out = await applySlashCommand('/billing 환불', { findSkillBySlug: find, enabled: true });
        expect(out).toContain('rules');
        expect(out).toContain('환불');
        expect(find).toHaveBeenCalledWith('billing', undefined);
    });
    it('미매칭 스킬 → 원문 유지', async () => {
        const find = jest.fn().mockResolvedValue(null);
        const out = await applySlashCommand('/path/to/x', { findSkillBySlug: find, enabled: true });
        expect(out).toBe('/path/to/x');
    });
    it('비활성 플래그 → 원문 (findSkill 미호출)', async () => {
        const find = jest.fn();
        const out = await applySlashCommand('/billing x', { findSkillBySlug: find, enabled: false });
        expect(out).toBe('/billing x');
        expect(find).not.toHaveBeenCalled();
    });
    it('해석기 throw → graceful 원문', async () => {
        const find = jest.fn().mockRejectedValue(new Error('db down'));
        const out = await applySlashCommand('/billing x', { findSkillBySlug: find, enabled: true });
        expect(out).toBe('/billing x');
    });
});

describe('slash skill activation metadata', () => {
    it('명시 호출된 스킬 이름을 활성화 이벤트용 콜백으로 전달한다', async () => {
        const find = jest.fn().mockResolvedValue({ name: 'Billing Guide', content: 'rules' });
        const onSkillApplied = jest.fn();
        const deps: ApplySlashDeps & { onSkillApplied: (skillName: string) => void } = {
            findSkillBySlug: find,
            enabled: true,
            onSkillApplied,
        };

        const message = await applySlashCommand('/billing-guide 환불', deps);

        expect(message).toContain('rules');
        expect(onSkillApplied).toHaveBeenCalledWith('Billing Guide');
    });

    it('명시 호출과 자동 선택 스킬을 순서 보존·중복 제거해 병합한다', () => {
        expect(mergeActivatedSkillNames(
            [' Billing Guide ', 'web-search'],
            ['web-search', 'Report', ''],
        )).toEqual(['Billing Guide', 'web-search', 'Report']);
    });
});

describe('기본 해석기 — userId 전달·하이픈 이름 재검색 (2026-08-16)', () => {
    it('searchSkills 에 userId 가 전달되고, 공백 복원 검색이 놓친 하이픈 이름을 원 slug 로 재검색해 매칭한다', async () => {
        const searchSkills = jest.fn()
            // 1차: 'design critique' (공백 복원) — 하이픈 이름이라 미매칭
            .mockResolvedValueOnce({ skills: [], total: 0, limit: 10, offset: 0 })
            // 2차: 'design-critique' (원 slug) — 매칭
            .mockResolvedValueOnce({
                skills: [{ name: 'design-critique', content: 'CRITIQUE_RULES' }],
                total: 1, limit: 10, offset: 0,
            });
        jest.doMock('../../agents/skill-manager', () => ({ getSkillManager: () => ({ searchSkills }) }));

        const out = await applySlashCommand('/design-critique 버튼 평가', { userId: 'u3' });
        expect(out).toContain('CRITIQUE_RULES');
        expect(searchSkills).toHaveBeenNthCalledWith(1, expect.objectContaining({ search: 'design critique', userId: 'u3' }));
        expect(searchSkills).toHaveBeenNthCalledWith(2, expect.objectContaining({ search: 'design-critique', userId: 'u3' }));

        jest.dontMock('../../agents/skill-manager');
    });
});

describe('한글 스킬명 slug (2026-07-04 유니코드 대응)', () => {
    it('한글 이름이 빈 slug 로 붕괴하지 않는다', () => {
        expect(slugify('데이터 시각화 가이드')).toBe('데이터-시각화-가이드');
    });
    it('한글 슬래시 명령이 파싱된다', () => {
        const r = parseSlashCommand('/데이터-시각화-가이드 월별 차트 추천');
        expect(r?.slug).toBe('데이터-시각화-가이드');
        expect(r?.rest).toBe('월별 차트 추천');
    });
    it('한글 slug 가 스킬 이름과 매칭된다', () => {
        expect(matchesSlug('데이터 시각화 가이드', '데이터-시각화-가이드')).toBe(true);
    });
});
