import { classifyAnswerIntent } from '../chat/answer-planner';
import {
    StructuredAnswerSchema,
    STRUCTURED_ANSWER_FORMAT,
    type StructuredAnswer,
} from '../schemas/structured-answer.schema';
import { formatAnswer, composeStructuredAnswer, type StructuredChatFn } from './answer-composer';

// ── Answer Planner (제안서 3절) ──────────────────────────────
describe('answer-planner: classifyAnswerIntent', () => {
    it('비교 질문 → comparison', () => {
        expect(classifyAnswerIntent('React랑 Vue 차이 비교해줘')).toBe('comparison');
        expect(classifyAnswerIntent('PostgreSQL vs MySQL 중 뭐가 나을까')).toBe('comparison');
    });
    it('에러/버그 질문 → troubleshooting', () => {
        expect(classifyAnswerIntent('이 API 가 500 에러 나는데 왜 안 돼?')).toBe('troubleshooting');
        expect(classifyAnswerIntent('빌드가 자꾸 실패하는데 디버그 어떻게 해')).toBe('troubleshooting');
    });
    it('의사결정 질문 → decision', () => {
        expect(classifyAnswerIntent('결제 PG를 직접 연동할지 토스로 갈지 결정해야 할까?')).toBe('decision');
        expect(classifyAnswerIntent('이 라이브러리 도입 추천해?')).toBe('decision');
    });
    it('설계 질문 → technical_design', () => {
        expect(classifyAnswerIntent('실시간 알림 시스템을 어떻게 설계해야 해?')).toBe('technical_design');
    });
    it('요약/작성 → summary / drafting', () => {
        expect(classifyAnswerIntent('이 문서 핵심만 요약해줘')).toBe('summary');
        expect(classifyAnswerIntent('사과 이메일 초안 작성해줘')).toBe('drafting');
    });
    it('키워드 미달은 detectPromptType fallback', () => {
        // 평이한 설명 요청 → explanation 계열
        expect(typeof classifyAnswerIntent('양자역학이 뭐야')).toBe('string');
    });

    // 제안서 6절: Evaluation Dataset — intent 분포 점검
    it('eval dataset: 대표 질문 10개 중 8개 이상 비-explanation 분류', () => {
        const dataset = [
            'A안과 B안 비교해줘',
            '서버가 죽는데 왜 그런지 모르겠어',
            'Redis 도입할까 말까?',
            '결제 시스템 아키텍처 어떻게 설계?',
            '이 글 요약해줘',
            '환불 안내 메일 써줘',
            'gRPC랑 REST 차이가 뭐야',
            '로그인이 자꾸 실패해 고쳐줘',
            '마이크로서비스로 갈지 결정 도와줘',
            '캐시 레이어 어떻게 구현하지',
        ];
        const intents = dataset.map(classifyAnswerIntent);
        const nonDefault = intents.filter((i) => i !== 'explanation').length;
        expect(nonDefault).toBeGreaterThanOrEqual(8);
    });
});

// ── Schema Validator (제안서 4절) ────────────────────────────
describe('structured-answer.schema: Validator', () => {
    const valid: StructuredAnswer = {
        intent: 'decision',
        title: '결제 연동 결정',
        conclusion: '토스페이먼츠를 권장합니다.',
        summary: '',
        sections: [{ heading: '근거', body: '연동 공수가 낮습니다.' }],
        confidence: 'medium',
    };
    it('정상 객체 통과', () => {
        expect(StructuredAnswerSchema.safeParse(valid).success).toBe(true);
    });
    it('필수 필드 누락 거부', () => {
        const bad = { ...valid } as Record<string, unknown>;
        delete bad.conclusion;
        expect(StructuredAnswerSchema.safeParse(bad).success).toBe(false);
    });
    it('잘못된 intent enum 거부', () => {
        expect(StructuredAnswerSchema.safeParse({ ...valid, intent: 'blog' }).success).toBe(false);
    });
    it('FormatOption 은 json_schema 변환용 properties/required 보유', () => {
        expect(typeof STRUCTURED_ANSWER_FORMAT).toBe('object');
        const f = STRUCTURED_ANSWER_FORMAT as { required?: string[]; properties: Record<string, unknown> };
        expect(f.required).toContain('conclusion');
        expect(f.properties).toHaveProperty('sections');
    });
});

// ── Response Formatter: formatAnswer (제안서 8절) ─────────────
describe('answer-composer: formatAnswer', () => {
    const answer: StructuredAnswer = {
        intent: 'comparison',
        title: 'DB 선택',
        conclusion: 'PostgreSQL을 권장합니다.',
        summary: '두 DB의 트레이드오프를 비교했습니다.',
        sections: [
            {
                heading: '비교',
                body: '핵심 차이는 다음과 같습니다.',
                table: { headers: ['항목', 'PG', 'MySQL'], rows: [['JSON', '강함', '보통']] },
            },
        ],
        risks: ['마이그레이션 비용'],
        action_items: ['PoC 진행', '벤치마크'],
        confidence: 'high',
    };

    it('결론을 요약·섹션보다 먼저 배치', () => {
        const md = formatAnswer(answer, 'ko');
        expect(md.indexOf('## 결론')).toBeLessThan(md.indexOf('## 요약'));
        expect(md.indexOf('## 결론')).toBeLessThan(md.indexOf('## 비교'));
    });
    it('표·주의할 점·다음 실행 렌더', () => {
        const md = formatAnswer(answer, 'ko');
        expect(md).toContain('| 항목 | PG | MySQL |');
        expect(md).toContain('| --- | --- | --- |');
        expect(md).toContain('## 주의할 점');
        expect(md).toContain('## 다음 실행');
        expect(md).toContain('- PoC 진행');
    });
    it('표 셀의 파이프 이스케이프', () => {
        const md = formatAnswer({
            ...answer,
            sections: [{ heading: 's', body: '', table: { headers: ['a'], rows: [['x|y']] } }],
        }, 'ko');
        expect(md).toContain('x\\|y');
    });
});

// ── Composer 파이프라인 (Validator 재시도) ───────────────────
describe('answer-composer: composeStructuredAnswer', () => {
    const validJson = JSON.stringify({
        intent: 'decision',
        title: 't',
        conclusion: 'c',
        sections: [{ heading: 'h', body: 'b' }],
        confidence: 'low',
    });

    it('유효 JSON → 구조화 + 마크다운 반환', async () => {
        const chat: StructuredChatFn = async () => validJson;
        const r = await composeStructuredAnswer({ message: '도입할까?', userLanguage: 'ko', chat });
        expect(r.structured.conclusion).toBe('c');
        expect(r.markdown).toContain('## 결론');
        expect(r.intent).toBe('decision');
    });

    it('현재 날짜가 system 프롬프트에 주입됨 (2024 컷오프 오인식 방지)', async () => {
        let sys = '';
        const chat: StructuredChatFn = async (msgs) => {
            sys = msgs.find((m) => m.role === 'system')?.content ?? '';
            return validJson;
        };
        await composeStructuredAnswer({ message: '올해 트렌드 결정해줘', chat, currentDate: '2026-06-26' });
        expect(sys).toContain('2026-06-26');
    });

    it('webContext 가 user 메시지에 합류됨', async () => {
        let userMsg = '';
        const chat: StructuredChatFn = async (msgs) => {
            userMsg = msgs.find((m) => m.role === 'user')?.content ?? '';
            return validJson;
        };
        await composeStructuredAnswer({
            message: '현직 대통령 누구야?',
            chat,
            webContext: '\n\n## 🔍 검색결과\n출처: 2026 뉴스...',
        });
        expect(userMsg).toContain('현직 대통령 누구야?');
        expect(userMsg).toContain('검색결과');
    });

    it('1차 깨진 JSON → 재시도 후 성공', async () => {
        let call = 0;
        const chat: StructuredChatFn = async () => {
            call += 1;
            return call === 1 ? '깨진 출력 {' : validJson;
        };
        const r = await composeStructuredAnswer({ message: '도입할까?', chat });
        expect(call).toBe(2);
        expect(r.structured.title).toBe('t');
    });

    it('마크다운 펜스로 감싼 JSON 도 파싱', async () => {
        const chat: StructuredChatFn = async () => '```json\n' + validJson + '\n```';
        const r = await composeStructuredAnswer({ message: '도입할까?', chat });
        expect(r.structured.intent).toBe('decision');
    });

    // 2026-08-23 계약 변경: 스키마를 못 맞춰도 422 로 죽지 않고 평문을 최소 구조로 감싸
    // degrade 한다(모델/백엔드 교체 시 구조화 엔드포인트가 통째로 죽는 것을 막기 위함).
    // 내용조차 비었을 때만 422 — 그 케이스는 answer-composer.degrade.test.ts 가 고정한다.
    it('계속 스키마 실패 → 422 대신 평문 degrade', async () => {
        const chat: StructuredChatFn = async () => 'not json at all';
        const r = await composeStructuredAnswer({ message: 'x', chat });
        expect(r.degraded).toBe('schema_invalid');
        expect(r.structured.conclusion).toBe('not json at all');
        expect(r.structured.confidence).toBe('low');
    });
});

describe('StructuredAnswerSchema — strict 스키마의 null 수용', () => {
    it('선택 필드가 null 로 와도 통과하고 미지정과 동일하게 정규화된다', () => {
        // strict json_schema 는 모든 키를 required 로 요구하므로 모델이 "값 없음"을 null 로 보낸다.
        const parsed = StructuredAnswerSchema.parse({
            intent: 'explanation', title: 'T', conclusion: 'C',
            summary: null, risks: null, action_items: null,
            sections: [{ heading: 'H', body: 'B', bullets: null, table: null }],
            confidence: 'high',
        });
        expect(parsed.summary).toBe('');
        expect(parsed.risks).toBeUndefined();
        expect(parsed.action_items).toBeUndefined();
        expect(parsed.sections[0].bullets).toBeUndefined();
        expect(parsed.sections[0].table).toBeUndefined();
    });
});
