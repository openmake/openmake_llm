import {
    parseSlashCommand,
    slugify,
    matchesSlug,
    buildAugmentedMessage,
    applySlashCommand,
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
