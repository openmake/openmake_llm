/**
 * Skill Guidelines - 카테고리별 전문 지침 및 에이전트 전문성 노트
 * 데이터는 JSON 파일에서 로드합니다.
 * @module agents/skill-guidelines
 */
import * as path from 'path';
import * as fs from 'fs';
import { builtinAddonDir } from '../addon-host/builtin-registry';

function loadJson<T>(filename: string): T {
    const filePath = path.join(builtinAddonDir('industry-pack'), 'data', filename);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

interface RichCategoryKnowledge {
    rolePrinciples: string[];
    methodologies: string[];
    toolsAndFrameworks: string[];
    challengePlaybook: Array<{ challenge: string; handling: string }>;
    standards: string[];
    outputGuidance: string[];
}

const guidelines: Record<string, string> = loadJson('category-guidelines.json');

export function getCategoryGuidelines(categoryId: string): string {
    return guidelines[categoryId] ?? guidelines.special;
}

export const CATEGORY_KNOWLEDGE: Record<string, RichCategoryKnowledge> = loadJson('category-knowledge.json');
export const AGENT_PROFESSIONAL_NOTES: Record<string, string> = loadJson('agent-professional-notes.json');
