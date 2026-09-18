/**
 * industry-pack 의 skills.json 은 생성물이다 — 입력(industry-agents.json·data/*.json)을 고치고
 * `npm run addons:build --workspace=apps/api` 를 잊으면 여기서 실패한다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { builtinAddonDir } from '../../builtin-registry';
import { buildIndustryPackSkills } from '../industry-pack-skills';

it('skills.json 이 생성기 출력과 같다', () => {
    const committed = JSON.parse(fs.readFileSync(path.join(builtinAddonDir('industry-pack'), 'skills.json'), 'utf-8'));
    expect(committed).toEqual(buildIndustryPackSkills());
});
