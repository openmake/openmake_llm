/**
 * 내장 팩 산출물 생성 — `npm run addons:build --workspace=apps/api`.
 * 지금은 industry-pack 의 skills.json 하나다(utility-pack 의 skills.json 은 직접 편집하는 원본).
 *
 * @module addon-host/authoring/build-packs
 */
import * as fs from 'fs';
import * as path from 'path';
import { builtinAddonDir } from '../builtin-registry';
import { buildIndustryPackSkills } from './industry-pack-skills';

const target = path.join(builtinAddonDir('industry-pack'), 'skills.json');
const skills = buildIndustryPackSkills();
fs.writeFileSync(target, `${JSON.stringify(skills, null, 2)}\n`);
console.log(`industry-pack: 스킬 ${skills.length}개 → ${target}`);
