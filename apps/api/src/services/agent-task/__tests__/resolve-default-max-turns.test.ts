import { resolveDefaultMaxTurns } from '../task-inputs';
import { AGENT_TASK_LIMITS, DOC_EXTRACT_LIMITS } from '../../../config/runtime-limits';

/**
 * 기본 턴 수 결정 — 특히 LARGE_INPUT_MAX_TURNS 가 DEFAULT_MAX_TURNS 보다 작아졌을 때
 * (기본 10→32 상향, 2026-08-19) 대형 첨부가 오히려 손해를 보는 역전이 없어야 한다.
 * 둘 다 env 로 조정 가능해 역전 자체는 언제든 재현될 수 있다.
 */
describe('resolveDefaultMaxTurns', () => {
    const bigFile = { name: 'scan.pdf', size: DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE + 1 };

    it('명시 maxTurns 가 오면 그대로 쓴다', () => {
        expect(resolveDefaultMaxTurns(7, undefined)).toBe(7);
        expect(resolveDefaultMaxTurns(7, [bigFile] as never)).toBe(7);
    });

    it('첨부가 없으면 기본값', () => {
        expect(resolveDefaultMaxTurns(undefined, undefined)).toBe(AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS);
    });

    it('대형 첨부는 기본값보다 작아지지 않는다(역전 방지)', () => {
        expect(resolveDefaultMaxTurns(undefined, [bigFile] as never))
            .toBeGreaterThanOrEqual(AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS);
    });

    /**
     * 추출 텍스트를 확보하지 못한 문서는 샌드박스에서 직접 파싱해야 하므로 턴 예산을 올린다.
     * 이 판정은 PDF·office·HWP 세 목록을 모두 봐야 하는데 HWP 만 빠져 있었다(2026-08-31).
     *
     * ⚠️ 기본 설정(DEFAULT 32 > LARGE_INPUT 20)에서는 Math.max 가 양쪽 다 32 를 내므로
     * 두 분기를 구분할 수 없다 — 그래서 여기서만 env 를 역전시켜(LARGE_INPUT > DEFAULT)
     * 판정 자체를 관측한다. 역전은 실제로 가능한 운영 설정이며, 그때 이 결함이 드러난다.
     */
    describe('추출 실패 문서 판정 — 확장자 목록 전체를 본다 (env 역전 조건)', () => {
        const ORIGINAL_ENV = { ...process.env };
        const DEFAULT = 8;
        const LARGE = 24;

        const load = () => {
            jest.resetModules();
            process.env = {
                ...ORIGINAL_ENV,
                AGENT_TASK_DEFAULT_MAX_TURNS: String(DEFAULT),
                AGENT_TASK_LARGE_INPUT_MAX_TURNS: String(LARGE),
            };
            return (require('../task-inputs') as typeof import('../task-inputs')).resolveDefaultMaxTurns;
        };

        afterEach(() => {
            process.env = { ...ORIGINAL_ENV };
            jest.resetModules();
        });

        it.each(['scan.pdf', 'sheet.xlsx', 'doc.docx', '공문.hwp', '공문.hwpx', '공문.hml'])(
            '%s — 추출 텍스트가 없으면 샌드박스 파싱 예산',
            (name) => {
                expect(load()(undefined, [{ name, size: 1024 }] as never)).toBe(LARGE);
            },
        );

        it('추출에 성공한 HWP 는 기본값 (대다수 경로 — 불필요한 예산 상향 방지)', () => {
            expect(load()(undefined, [{ name: '공문.hwp', size: 1024, content: '본문' }] as never))
                .toBe(DEFAULT);
        });

        it('추출 대상이 아닌 확장자는 기본값', () => {
            expect(load()(undefined, [{ name: 'memo.txt', size: 1024 }] as never)).toBe(DEFAULT);
        });
    });
});
