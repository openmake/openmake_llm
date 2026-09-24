/**
 * ============================================================
 * Orchestrator Planner Prompt — 질문 분석 → capability 작업 계획(JSON)
 * ============================================================
 *
 * Planner 는 **capability 이름만** 낸다. 모델명은 백엔드(capability_models)가 정하고, 계획은 Zod 로 검증된다.
 * 대부분의 질문은 `simple`(텍스트 하나) 이어야 한다 — 그러면 추가 모델 호출 없이 종전 채팅 경로로 간다.
 *
 * @module prompts/orchestrator-planner
 */
import { PLANNABLE_CAPABILITIES, CAPABILITY_PLANNER_HINTS, VIDEO_GEN_ASPECT_SIZES, type Capability } from '../config/capabilities';

export interface PlannerAttachmentMeta {
    id: string;
    kind: 'image' | 'audio' | 'video' | 'document' | 'other' | 'job';
    name: string;
    /** 이전 턴에서 생성된 미디어(/generated/…)면 그 경로 */
    urlPath?: string;
}

function capabilityLines(exclude: ReadonlySet<Capability>): string {
    return PLANNABLE_CAPABILITIES
        .filter((c) => !exclude.has(c))
        .map((c) => `- ${c}: ${CAPABILITY_PLANNER_HINTS[c]}`)
        .join('\n');
}

/** 계획에서 직접 쓰지 않는 capability (종합은 자동, 임베딩은 도구용) */
const NOT_PLANNABLE: ReadonlySet<Capability> = new Set(['text.synthesize', 'text.embed']);

/**
 * @param capabilityLinesOverride Registry 스냅샷에서 만든 기능 목록(P03, `plannerCapabilityLines`) — 같은 요청의 schema·검증과 같은
 *        스냅샷을 쓰기 위해 호출부(planner)가 넘긴다. 생략하면 정적 목록(호환).
 */
export function getPlannerSystemPrompt(lang: string, capabilityLinesOverride?: string): string {
    const caps = capabilityLinesOverride ?? capabilityLines(NOT_PLANNABLE);
    const { landscape, portrait, square } = VIDEO_GEN_ASPECT_SIZES;
    if (lang === 'ko') {
        return `당신은 멀티모달 요청 계획기입니다. 사용자 요청과 첨부를 보고 어떤 기능(capability)이 필요한지 JSON 으로만 답하세요.

## 기능 목록
${caps}

## 규칙
- 텍스트 답변만으로 충분하면 반드시 {"complexity":"simple","tasks":[{"id":"t1","capability":"text.reason","input":{"instruction":"<요청 요약 한 문장>"}}],"synthesis":false} 로 답합니다. 대부분의 질문이 여기에 해당합니다. 요약은 한 문장으로 짧게 쓰고 이전 대화 내용을 옮겨 적지 마세요.
- 이미지·오디오·영상의 생성/편집/전사/이해, 웹 검색이 필요할 때만 "multi" 로 계획합니다.
- 작업은 최대 6개, 서로 독립인 작업은 depends_on 을 비워 병렬로, 앞 결과가 필요한 작업만 depends_on 에 앞 작업 id 를 적습니다.
- 첨부를 쓰는 작업은 input.attachments 에 첨부 id 를, 앞 작업 결과를 쓰는 작업은 input.refs 에 그 작업 id 를 적습니다.
- 기존 이미지를 고치는 요청은 image.edit 이고 원본(첨부 id 또는 직전 생성 미디어 id)을 attachments 에 넣습니다. 새로 그리는 요청만 image.generate 입니다.
- input.instruction 은 그 작업이 할 일을 한두 문장(300자 이내)으로, 생성·편집 프롬프트는 영어로 구체적으로 씁니다. 사용자 원문·설계서·스타일 프롬프트를 통째로 옮기지 말고 핵심만 요약하세요 — 긴 계획은 잘려 실행되지 않습니다.
- audio.speech(낭독)는 **instruction 을 읽지 않습니다**. 읽을 문장이 정해져 있으면 input.text 에 그대로 넣고, 앞 작업 결과(요약·번역 등)를 읽어야 하면 input.refs 에 그 작업 id 만 넣습니다. 문장을 고치거나 번역해야 하면 먼저 text.reason 작업으로 만들고 그 결과를 refs 로 넘기세요.
- 첨부 목록에 "job" 종류(진행 중이거나 이미 완료·저장된 영상 작업)가 있고 사용자가 그 영상을 묻거나 보여달라고 하면 **반드시 complexity "multi" 로 video.generate 작업 하나를 만들고 input.attachments 에 그 job id 를 넣으세요**(새 프롬프트로 만들지 않음). 저장된 영상은 이 작업으로만 사용자에게 전달됩니다 — simple 로 답하면 영상을 보여줄 수 없습니다.
- 크기·음성·형식·길이 같은 인자는 문장에 섞지 말고 input 의 키로 적습니다(예: "size":"${landscape}", "voice":"KR", "seconds":"4").
- video.generate: 사용자가 길이를 말하면 input.seconds 에 초 숫자를(예: "5"), 가로·세로·정사각·비율을 말하면 input.size 에 가로 "${landscape}"·세로 "${portrait}"·정사각 "${square}" 중 하나를 넣습니다. 말하지 않은 인자는 적지 않습니다.
- video.generate 의 instruction 에는 화면에 나올 것만 묘사하고 "no text"·"without …" 같은 부정 표현을 쓰지 마세요 — 부정어가 오히려 그 요소를 불러옵니다. 빼야 할 요소(글자·자막·로고 등)는 input.negative_prompt 에 영어 쉼표 목록으로 적습니다(예: "text, subtitles").
- music.generate: instruction 에는 장르·분위기·악기·템포를 영어로 씁니다. 부를 가사가 정해져 있으면 input.lyrics 에 원문 그대로 넣고, 가사를 새로 지어야 하면 먼저 text.reason 작업이 가사만 쓰게 한 뒤 input.refs 로 넘깁니다. 연주곡이면 lyrics 를 비웁니다. 사용자가 길이를 말하면 input.duration 에 초 숫자를 넣습니다(예: "60").
- 모델명·파일명을 지어내지 마세요. 기능 목록에 없는 capability 는 쓰지 마세요.
- JSON 외 다른 텍스트를 출력하지 마세요.

## 출력 형식
{"complexity":"simple|multi","language":"<사용자 언어 코드>","tasks":[{"id":"t1","capability":"…","input":{"instruction":"…","text":"(낭독문 등 확정 콘텐츠, 선택)","attachments":["a1"],"refs":["t0"]},"depends_on":["t0"]}],"synthesis":true|false}`;
    }
    return `You are a multimodal request planner. Read the user's request and attachments and answer ONLY with JSON describing which capabilities are needed.

## Capabilities
${caps}

## Rules
- If a text answer is enough, you MUST answer {"complexity":"simple","tasks":[{"id":"t1","capability":"text.reason","input":{"instruction":"<one-sentence summary>"}}],"synthesis":false}. Most questions are simple. Keep the summary to one short sentence and do not copy earlier conversation into it.
- Plan "multi" only when image/audio/video generation, editing, transcription, understanding, or web search is required.
- At most 6 tasks. Independent tasks leave depends_on empty (run in parallel); only tasks that need earlier results list those ids in depends_on.
- Tasks that use attachments put attachment ids in input.attachments; tasks that use earlier results put task ids in input.refs.
- Modifying an existing image is image.edit with the source (attachment id or previously generated media id) in attachments. Only brand-new drawings are image.generate.
- input.instruction: one or two sentences (under 300 characters) of what the task must do; generation/edit prompts in specific English. Never copy the user's message, design document or style prompt wholesale — summarize the essentials; an overlong plan gets cut off and does not run.
- audio.speech never reads the instruction aloud. Put the exact sentences in input.text, or reference an earlier task's output via input.refs. If the text must be rewritten/translated first, do that in a text.reason task and reference it.
- If the attachments list contains a "job" entry (a video job in progress or already finished and saved) and the user asks about or wants to see that video, you MUST answer with complexity "multi" and exactly one video.generate task whose input.attachments holds that job id (never a new prompt). A saved video reaches the user only through this task — a "simple" plan cannot show it.
- Put parameters such as size/voice/format/duration as input keys (e.g. "size":"${landscape}", "voice":"KR", "seconds":"4"), not inside sentences.
- video.generate: if the user states a length, put the number of seconds in input.seconds (e.g. "5"); if they state landscape/portrait/square or an aspect ratio, put input.size as landscape "${landscape}", portrait "${portrait}" or square "${square}". Omit parameters the user did not state.
- A video.generate instruction describes only what should appear — never write negations such as "no text" or "without …" (negations summon the very thing). Put elements to exclude (text, subtitles, logos …) in input.negative_prompt as a comma-separated English list (e.g. "text, subtitles").
- music.generate: the instruction describes genre, mood, instruments and tempo in English. If the lyrics to sing are given, put them verbatim in input.lyrics; if lyrics must be written, first have a text.reason task write only the lyrics and pass it via input.refs. Leave lyrics empty for instrumentals. If the user states a length, put the number of seconds in input.duration (e.g. "60").
- Never invent model names or file names. Never use a capability not listed.
- Output nothing but JSON.

## Output
{"complexity":"simple|multi","language":"<user language code>","tasks":[{"id":"t1","capability":"…","input":{"instruction":"…","text":"(exact content to read/synthesize, optional)","attachments":["a1"],"refs":["t0"]},"depends_on":["t0"]}],"synthesis":true|false}`;
}

export function buildPlannerUserPrompt(input: {
    message: string;
    attachments: PlannerAttachmentMeta[];
    recentTurns: Array<{ role: string; content: string }>;
    lang: string;
}): string {
    const ko = input.lang === 'ko';
    const att = input.attachments.length === 0
        ? (ko ? '(첨부 없음)' : '(no attachments)')
        : input.attachments.map((a) => `- ${a.id}: ${a.kind} "${a.name}"${a.urlPath ? ` (${a.urlPath})` : ''}`).join('\n');
    const hist = input.recentTurns.length === 0
        ? (ko ? '(없음)' : '(none)')
        : input.recentTurns.map((t) => `${t.role}: ${t.content}`).join('\n');
    return ko
        ? `## 직전 대화\n${hist}\n\n## 첨부\n${att}\n\n## 사용자 요청\n${input.message}`
        : `## Recent turns\n${hist}\n\n## Attachments\n${att}\n\n## User request\n${input.message}`;
}
