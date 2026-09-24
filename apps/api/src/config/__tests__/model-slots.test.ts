/**
 * 슬롯 정의(config/model-slots)와 마이그레이션 170 의 역할·기능 → 슬롯 대응이 어긋나지 않게 고정한다.
 * (어긋나면 이관 데이터의 슬롯과 코드가 읽는 슬롯이 달라져 배정이 조용히 사라진다)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { MODEL_SLOTS, ROLE_SLOT, CAPABILITY_SLOT, USER_ASSIGNABLE_SLOTS } from '../model-slots';
import { MODEL_ROLES } from '../model-roles';
import { ASSIGNABLE_CAPABILITIES } from '../capabilities';

/** 마이그레이션 SQL 의 `CASE <col> WHEN 'x' THEN 'y' ... END` 에서 x→y 쌍을 뽑는다 */
function parseCase(sql: string, col: string): Record<string, string> {
    const block = new RegExp(`CASE ${col.replace('.', '\\.')}\\s+([\\s\\S]*?)\\s+END`).exec(sql);
    if (!block) throw new Error(`CASE ${col} 블록을 찾지 못했습니다`);
    const pairs: Record<string, string> = {};
    const re = /WHEN\s+'([^']+)'\s+THEN\s+'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block[1]))) pairs[m[1]] = m[2];
    return pairs;
}

const MIGRATION_SQL = readFileSync(
    join(__dirname, '../../../../../db/migrations/170_model_assignments.sql'),
    'utf8',
);

describe('model-slots', () => {
    it('슬롯 id 는 유일하다', () => {
        const ids = MODEL_SLOTS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('모든 ModelRole 은 정확히 한 슬롯에 대응한다', () => {
        for (const role of MODEL_ROLES) {
            const owning = MODEL_SLOTS.filter((s) => s.roles.includes(role));
            expect(owning).toHaveLength(1);
            expect(ROLE_SLOT[role]).toBe(owning[0].id);
        }
    });

    it('모든 배정 가능 Capability 는 정확히 한 슬롯에 대응한다', () => {
        for (const cap of ASSIGNABLE_CAPABILITIES) {
            const owning = MODEL_SLOTS.filter((s) => s.capabilities.includes(cap));
            expect(owning).toHaveLength(1);
            expect(CAPABILITY_SLOT[cap]).toBe(owning[0].id);
        }
    });

    it('USER_ASSIGNABLE_SLOTS 는 모두 group 이 있다(화면 표시용)', () => {
        for (const slot of USER_ASSIGNABLE_SLOTS) expect(slot.group).not.toBeNull();
    });

    it('마이그레이션 170 의 CASE 매핑이 ROLE_SLOT/CAPABILITY_SLOT 과 일치한다', () => {
        const capCase = parseCase(MIGRATION_SQL, 'capability');
        const roleCase = parseCase(MIGRATION_SQL, 'role');

        // 합쳐진 슬롯의 명시 매핑
        expect(capCase).toEqual({ 'text.code': 'code', 'text.reason': 'reasoning' });
        expect(roleCase).toEqual({ review: 'code', research: 'reasoning' });

        // capability: CASE 에 있는 것은 그 값, 없는 것은 ELSE(=capability 그대로)
        for (const cap of ASSIGNABLE_CAPABILITIES) {
            const expected = capCase[cap] ?? cap;
            expect(CAPABILITY_SLOT[cap]).toBe(expected);
        }
        // role: CASE 에 있는 것은 그 값, 없는 것은 ELSE(=role 그대로)
        for (const role of MODEL_ROLES) {
            const expected = roleCase[role] ?? role;
            expect(ROLE_SLOT[role]).toBe(expected);
        }
    });
});
