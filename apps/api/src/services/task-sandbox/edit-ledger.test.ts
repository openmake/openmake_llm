import { EditLedger, ledgerKey } from './edit-ledger';

describe('EditLedger — 편집 해시 비교 후 교체(하네스 P2-6)', () => {
    it('꺼져 있으면 기록도 판정도 하지 않는다(종전 동작)', () => {
        const l = new EditLedger(false);
        l.observe('a.txt', 'v1');
        expect(l.check('a.txt', 'v2')).toEqual({ ok: true });
        expect(l.check('a.txt', null)).toEqual({ ok: true });
    });

    it('처음 만지는 경로는 막지 않는다', () => {
        expect(new EditLedger(true).check('new.txt', 'anything')).toEqual({ ok: true });
    });

    it('본 내용 그대로면 통과, 바뀌었으면 충돌, 지워졌으면 deleted', () => {
        const l = new EditLedger(true);
        l.observe('a.txt', 'v1');
        expect(l.check('a.txt', 'v1')).toEqual({ ok: true });
        expect(l.check('a.txt', 'v1-changed')).toEqual({ ok: false, deleted: false });
        expect(l.check('a.txt', null)).toEqual({ ok: false, deleted: true });
    });

    it('같은 파일의 다른 표기는 한 키다', () => {
        expect(ledgerKey('/workspace/src/a.ts')).toBe('src/a.ts');
        expect(ledgerKey('./src//a.ts')).toBe('src/a.ts');
        const l = new EditLedger(true);
        l.observe('/workspace/src/a.ts', 'v1');
        expect(l.check('./src/a.ts', 'v2').ok).toBe(false);
    });

    it('forget·clear 뒤에는 막지 않는다', () => {
        const l = new EditLedger(true);
        l.observe('a', '1'); l.observe('b', '1');
        l.forget('a');
        expect(l.check('a', '2').ok).toBe(true);
        expect(l.check('b', '2').ok).toBe(false);
        l.clear();
        expect(l.check('b', '2').ok).toBe(true);
    });
});
