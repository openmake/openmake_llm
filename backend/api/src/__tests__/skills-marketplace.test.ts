/**
 * ============================================================
 * Skills Marketplace Service Tests
 * ============================================================
 *
 * GitHub API 연동 및 SKILL.md 파싱 로직 테스트
 *
 * @module __tests__/skills-marketplace.test
 */
import { SkillsMarketplaceService } from '../services/SkillsMarketplaceService';

describe('SkillsMarketplaceService', () => {
    let service: SkillsMarketplaceService;

    beforeEach(() => {
        // 매 테스트마다 새 인스턴스 생성
        service = new SkillsMarketplaceService();
    });

    describe('parseSkillMd', () => {
        test('기본 SKILL.md 파싱 - 이름 추출', () => {
            const content = `# My Custom Skill

> This is a description for my skill.

## Instructions
This is the main content.`;

            const result = service.parseSkillMd(content);

            expect(result.name).toBe('My Custom Skill');
            expect(result.description).toBe('This is a description for my skill.');
            expect(result.content).toContain('This is the main content.');
        });

        test('카테고리 추출 - **category**: 형식', () => {
            const content = `# Test Skill

> Description here.
**category**: testing

## Instructions
Main content here.`;

            const result = service.parseSkillMd(content);

            expect(result.category).toBe('testing');
        });

        test('카테고리 추출 - category: 형식', () => {
            const content = `# Test Skill

> Description here.
category: backend

## Instructions
Main content.`;

            const result = service.parseSkillMd(content);

            expect(result.category).toBe('backend');
        });

        test('설명 여러 줄 연결', () => {
            const content = `# Multi-line Skill

> First line of description
> Second line of description
> Third line

## Instructions
Content here.`;

            const result = service.parseSkillMd(content);

            expect(result.description).toContain('First line');
            expect(result.description).toContain('Second line');
            expect(result.description).toContain('Third line');
        });

        test('## Instructions 블록 이후 내용만 content로 추출', () => {
            const content = `# Skill With Instructions

> Description here.

## Instructions
This is the actual skill content.

Some more content.
Final line.`;

            const result = service.parseSkillMd(content);

            expect(result.content).toBe('This is the actual skill content.\n\nSome more content.\nFinal line.');
        });

        test('## Instructions가 없으면 전체 content 반환', () => {
            const content = `# Skill Without Instructions

> Description here.

This is all content without instructions header.`;

            const result = service.parseSkillMd(content);

            expect(result.content).toContain('This is all content');
        });

        test('기본값 - 이름 없는 경우', () => {
            const content = `> Description only

## Instructions
Content here.`;

            const result = service.parseSkillMd(content);

            expect(result.name).toBe('Uncategorized Skill');
        });

        test('기본값 - 설명 없는 경우', () => {
            const content = `# Skill Name

## Instructions
Content only.`;

            const result = service.parseSkillMd(content);

            expect(result.description).toBe('No description found in SKILL.md');
        });

        test('기본값 - 카테고리 없는 경우', () => {
            const content = `# Skill Name

> Description.

## Instructions
Content.`;

            const result = service.parseSkillMd(content);

            expect(result.category).toBe('general');
        });

        test('대소문자 무시 - category: (소문자)', () => {
            const content = `# Skill

> Desc
CATEGORY: uppercasecategory

## Instructions
Content.`;

            const result = service.parseSkillMd(content);

            expect(result.category).toBe('uppercasecategory');
        });
    });
});
