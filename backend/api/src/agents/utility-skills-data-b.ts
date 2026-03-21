/**
 * Utility Skills Data - Group B (creative, education, business, science)
 * 데이터는 JSON 파일에서 로드합니다.
 * @module agents/utility-skills-data-b
 */
import * as fs from 'fs';
import * as path from 'path';

import type { UtilitySkillDef } from './utility-skills-data-a';

const dataDir = path.join(__dirname, 'data');

function loadJson<T>(filename: string): T {
    return JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf-8')) as T;
}

export const UTILITY_SKILLS_B: UtilitySkillDef[] = loadJson('utility-skills-b.json');
