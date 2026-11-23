import { autoCreateSkillSchema, draftsQuerySchema, searchSkillsQuerySchema } from '../skills.schema';

describe('autoCreateSkillSchema', () => {
  it('accepts minimum valid input', () => {
    const r = autoCreateSkillSchema.parse({ purpose: '의료법 자문' });
    expect(r.target).toBe('user');
    expect(r.purpose).toBe('의료법 자문');
  });

  it('rejects purpose < 5 chars', () => {
    expect(() => autoCreateSkillSchema.parse({ purpose: 'abc' })).toThrow();
  });

  it('rejects examples > 5', () => {
    const examples = Array.from({ length: 6 }, (_, i) => `예시${i}`);
    expect(() => autoCreateSkillSchema.parse({ purpose: '의료법 자문', examples })).toThrow();
  });

  it('accepts target=system', () => {
    const r = autoCreateSkillSchema.parse({ purpose: '의료법 자문', target: 'system' });
    expect(r.target).toBe('system');
  });

  it('rejects target=admin (enum)', () => {
    expect(() => autoCreateSkillSchema.parse({ purpose: '의료법 자문', target: 'admin' })).toThrow();
  });
});

describe('draftsQuerySchema', () => {
  it('defaults target to user, limit to 50', () => {
    const r = draftsQuerySchema.parse({});
    expect(r.target).toBe('user');
    expect(r.limit).toBe(50);
  });

  it('coerces limit string to number', () => {
    const r = draftsQuerySchema.parse({ limit: '30' });
    expect(r.limit).toBe(30);
  });
});

// searchSkillsQuerySchema.status 필드는 보안상 의도적으로 제거됨.
// draft 조회는 draftsQuerySchema + /drafts 엔드포인트로만 가능.

describe('searchSkillsQuerySchema.isPublic', () => {
  it("쿼리 문자열 'false' 는 false, 'true' 는 true, 없으면 undefined", () => {
    expect(searchSkillsQuerySchema.parse({ isPublic: 'false' }).isPublic).toBe(false);
    expect(searchSkillsQuerySchema.parse({ isPublic: 'true' }).isPublic).toBe(true);
    expect(searchSkillsQuerySchema.parse({}).isPublic).toBeUndefined();
  });

  it('그 밖의 값은 거절한다', () => {
    expect(() => searchSkillsQuerySchema.parse({ isPublic: 'yes' })).toThrow();
  });
});
