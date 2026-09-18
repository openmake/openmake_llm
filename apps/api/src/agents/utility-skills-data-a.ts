/**
 * Utility Skills Data - Group A (general, coding, writing, analysis)
 * 데이터는 JSON 파일에서 로드합니다.
 * @module agents/utility-skills-data-a
 */
import * as fs from 'fs';
import * as path from 'path';
import { builtinAddonDir } from '../addon-host/builtin-registry';

const dataDir = path.join(builtinAddonDir('utility-pack'), 'data');

function loadJson<T>(filename: string): T {
    return JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf-8')) as T;
}

export interface UtilitySkillDef {
    id: string;
    name: string;
    /** 영어 표시 이름 — 한국어 외 UI 의 스킬 칩용 */
    nameEn?: string;
    description: string;
    category: string;
    content: string;
}

export const UTILITY_SKILLS_A: UtilitySkillDef[] = loadJson('utility-skills-a.json');
