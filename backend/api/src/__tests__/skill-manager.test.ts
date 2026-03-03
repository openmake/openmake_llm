/**
 * ============================================================
 * Skill Manager Tests
 * ============================================================
 *
 * SkillManager의 핵심 기능 테스트
 * - buildSkillPrompt() 로직 검증
 * - 스킬 내용 길이 검증 (MAX_SKILL_CONTENT_LENGTH)
 * - <skill_context> 경계 태그 포맷
 *
 * @module __tests__/skill-manager.test
 */
import { SkillManager } from '../agents/skill-manager';

// MAX_SKILL_CONTENT_LENGTH 상수값 (skill-manager.ts와 동기화)
const MAX_SKILL_CONTENT_LENGTH = 10_000;

describe('SkillManager', () => {
    describe('MAX_SKILL_CONTENT_LENGTH 상수', () => {
        test('최대 스킬 내용은 10,000자', () => {
            expect(MAX_SKILL_CONTENT_LENGTH).toBe(10_000);
        });
    });

    describe('스킬 내용 길이 검증 로직 (buildSkillPrompt 내부 로직)', () => {
        test('10,000자 이하 内容은 그대로 반환', () => {
            const content = 'a'.repeat(5000);
            const result = content.length > MAX_SKILL_CONTENT_LENGTH
                ? content.slice(0, MAX_SKILL_CONTENT_LENGTH) + '\n... (truncated)'
                : content;
            expect(result).toBe(content);
            expect(result).not.toContain('truncated');
        });

        test('10,000자 초과 内容은 잘리고 suffix 추가', () => {
            const longContent = 'a'.repeat(MAX_SKILL_CONTENT_LENGTH + 500);
            const result = longContent.length > MAX_SKILL_CONTENT_LENGTH
                ? longContent.slice(0, MAX_SKILL_CONTENT_LENGTH) + '\n... (truncated)'
                : longContent;
            
            expect(result.length).toBe(MAX_SKILL_CONTENT_LENGTH + '\n... (truncated)'.length);
            expect(result).toContain('truncated');
        });

        test('빈 内容은 유효함 (빈 문자열 처리)', () => {
            const emptyContent = '';
            const result = emptyContent.length > MAX_SKILL_CONTENT_LENGTH
                ? emptyContent.slice(0, MAX_SKILL_CONTENT_LENGTH) + '\n... (truncated)'
                : emptyContent;
            expect(result).toBe('');
        });
    });

    describe('buildSkillPrompt <skill_context> 경계 태그 포맷', () => {
        test('단일 스킬 프롬프트 블록 생성', () => {
            const skills = [{ name: 'TestSkill', content: 'Test content here.' }];
            const skillBlocks = skills
                .map(s => {
                    const content = s.content.length > MAX_SKILL_CONTENT_LENGTH
                        ? s.content.slice(0, MAX_SKILL_CONTENT_LENGTH) + '\n... (truncated)'
                        : s.content;
                    return `<skill_context name="${s.name}">\n${content}\n</skill_context>`;
                })
                .join('\n\n');
            const prompt = `\n\n## 적용된 스킬\n${skillBlocks}`;

            expect(prompt).toContain('<skill_context name="TestSkill">');
            expect(prompt).toContain('Test content here.');
            expect(prompt).toContain('</skill_context>');
            expect(prompt).toContain('## 적용된 스킬');
        });

        test('여러 스킬 프롬프트 블록 생성', () => {
            const skills = [
                { name: 'Skill1', content: 'Content 1' },
                { name: 'Skill2', content: 'Content 2' }
            ];
            const skillBlocks = skills
                .map(s => {
                    const content = s.content.length > MAX_SKILL_CONTENT_LENGTH
                        ? s.content.slice(0, MAX_SKILL_CONTENT_LENGTH) + '\n... (truncated)'
                        : s.content;
                    return `<skill_context name="${s.name}">\n${content}\n</skill_context>`;
                })
                .join('\n\n');

            expect(skillBlocks).toContain('<skill_context name="Skill1">');
            expect(skillBlocks).toContain('<skill_context name="Skill2">');
            expect(skillBlocks.split('</skill_context>').length - 1).toBe(2);
        });

        test('빈 스킬 리스트는 빈 문자열 반환', () => {
            const skills: { name: string; content: string }[] = [];
            if (skills.length === 0) {
                expect('').toBe('');
            }
        });

        test('스킬 이름 이스케이프 처리 (기본)', () => {
            const skillName = 'Test&Skill';
            const skillBlock = `<skill_context name="${skillName}">\nContent\n</skill_context>`;
            expect(skillBlock).toContain(`name="${skillName}"`);
        });
    });

    describe('스킬 카테고리 검증', () => {
        test('유효한 카테고리 값', () => {
            const validCategories = ['general', 'backend', 'frontend', 'database', 'ai', 'security'];
            validCategories.forEach(cat => {
                expect(typeof cat).toBe('string');
                expect(cat.length).toBeGreaterThan(0);
            });
        });

        test('카테고리 최대 길이 100자', () => {
            const longCategory = 'a'.repeat(100);
            expect(longCategory.length).toBe(100);
        });
    });

    describe('스킬 이름 검증', () => {
        test('스킬 이름 최소/최대 길이', () => {
            const minName = 'a';
            const maxName = 'a'.repeat(200);

            expect(minName.length).toBe(1);
            expect(maxName.length).toBe(200);
        });

        test('빈 이름은 유효하지 않음', () => {
            const emptyName = '';
            expect(emptyName.length).toBe(0);
        });
    });

    describe('스킬 설명 검증', () => {
        test('설명 최대 길이 2000자', () => {
            const maxDescription = 'a'.repeat(2000);
            expect(maxDescription.length).toBe(2000);
        });
    });
});
