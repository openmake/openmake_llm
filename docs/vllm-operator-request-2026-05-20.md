# vLLM 운영자 조치 요청 — reasoning-parser 재설정

**대상**: rockyhan.duckdns.org:13401 vLLM 서버 운영자
**작성일**: 2026-05-20
**우선순위**: 중 (메인 채팅은 client-side workaround 로 정상 동작 / 메타 LLM 호출만 영향)
**시스템 fingerprint**: `vllm-0.21.1rc1.dev64+g2e40faf08-a415c0de`
**모델**: `exaone4.5-33b-awq` (LGAI-EXAONE/EXAONE-4.5-33B-AWQ)

---

## 1. 증상 요약

OpenAI 호환 `/v1/chat/completions` 응답에서 EXAONE-4.5 모델의 **모든** 출력이 `message.content` 가 아니라 `message.reasoning_content` 채널로 라우팅됨. `chat_template_kwargs.enable_thinking: false` 를 명시 전송해도 동일.

## 2. 재현 (curl)

### Case A — enable_thinking 미전달 (기본값)

```bash
curl -sX POST https://YOUR_HOST/v1/chat/completions \
  -H "Authorization: Bearer KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "exaone4.5-33b-awq",
    "messages": [{"role":"user","content":"JSON only: {\"answer\":2}"}],
    "max_tokens": 64
  }'
```

응답:
```json
{
  "finish_reason": "length",
  "message": {
    "content": null,
    "reasoning_content": "Okay, the user provided a JSON object with the key \"answer\"..."
  },
  "usage": { "completion_tokens": 64 }
}
```

**해석**: reasoning 만 64토큰 모두 소진, 본 답변 미생성.

### Case B — enable_thinking=false 명시

```bash
curl -sX POST https://YOUR_HOST/v1/chat/completions \
  -H "Authorization: Bearer KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "exaone4.5-33b-awq",
    "messages": [{"role":"user","content":"JSON only: {\"answer\":2}"}],
    "max_tokens": 64,
    "chat_template_kwargs": {"enable_thinking": false}
  }'
```

응답:
```json
{
  "finish_reason": "stop",
  "message": {
    "content": null,
    "reasoning_content": "{\"answer\": 2}"
  },
  "usage": { "completion_tokens": 7 }
}
```

**해석**: chat_template 은 정상 동작 (reasoning 없이 JSON 7토큰만 출력). 그러나 vLLM 의 reasoning-parser 가 그 정상 JSON 출력을 `reasoning_content` 로 오분류함.

## 3. 근본 원인 분석

| 단계 | 동작 | 평가 |
|---|---|---|
| 1. chat_template (jinja) | `enable_thinking: false` 시 `<think>` 블록 prepend 생략 | ✅ 정상 |
| 2. 모델 추론 | reasoning 토큰 미생성, 본 답변만 출력 | ✅ 정상 |
| 3. vLLM **reasoning-parser** | 출력에 `<think>` 경계 토큰이 없음에도 *전체* 를 reasoning 으로 분류 | ❌ 오류 |

vLLM 0.21+ 의 `--reasoning-parser` (deepseek_r1 / qwen3 등) 는 출력 스트림에서 `<think>...</think>` 경계 토큰을 찾아 분리하도록 설계됨. 그러나 EXAONE 4.5 가 `enable_thinking: false` 모드에서는 그 경계 토큰 자체를 emit 하지 않으므로, parser 가 **"경계 없음 = 전부 reasoning"** 으로 fallback 처리 — edge case.

## 4. 권장 조치 (택1)

### 옵션 A (권장 / 즉시) — reasoning-parser 비활성화

vllm serve 기동 명령에서 `--reasoning-parser` 옵션을 **제거**.

```bash
# Before
vllm serve LGAI-EXAONE/EXAONE-4.5-33B-AWQ \
  --reasoning-parser deepseek_r1 \
  --enable-auto-tool-choice --tool-call-parser hermes \
  ...

# After
vllm serve LGAI-EXAONE/EXAONE-4.5-33B-AWQ \
  --enable-auto-tool-choice --tool-call-parser hermes \
  ...
```

**효과**:
- 모든 출력이 `message.content` 로 정상 라우팅
- `enable_thinking: true` 시 `<think>...</think>` 가 content 안에 inline 삽입 — OpenMake 클라이언트는 이미 client-side `parseReasoningTags()` 로 분리 처리 중 (방어 코드 존재)
- `enable_thinking: false` 시 reasoning 자체 없음 — content 에 JSON/답변만

**리스크**: 없음. 클라이언트는 양쪽 모두 처리 가능.

### 옵션 B (대안) — 다른 reasoning parser 시도

```bash
--reasoning-parser qwen3   # 또는
--reasoning-parser <custom EXAONE plugin>
```

EXAONE 전용 parser 가 존재하지 않으므로 권장하지 않음.

### 옵션 C (장기) — EXAONE chat_template 수정

`<think>` 토큰 경계를 항상 emit 하도록 chat_template jinja 수정. 모델 maintainer 영역 — 가장 무거움.

## 5. 영향 범위 (현 상태)

| 영역 | 상태 | 비고 |
|---|---|---|
| 메인 채팅 응답 | ✅ 정상 | OpenMake stream-parser 가 `reasoning_content` → `content` 자동 승격 워크어라운드 적용 (2026-05-19) |
| Agent specialization 라우팅 | ❌ 키워드 폴백 | `JSON.parse(reasoning_text)` 실패 → `[LLMRouter] 타임아웃 - 폴백 사용` 빈발 |
| 분류기 (LLMClassifier) | ⚠️ 캐시로 가려짐 | cold call 시 동일 증상 가능 |
| 요약기 (HistorySummarizer) | ⚠️ 부분 정상 | 자연어 출력이라 reasoning_content 도 그대로 활용 가능 |

## 6. 조치 후 검증 절차

```bash
# Expected: content="2" 또는 자연어, reasoning_content=null
curl -sX POST https://YOUR_HOST/v1/chat/completions \
  -H "Authorization: Bearer KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "exaone4.5-33b-awq",
    "messages": [{"role":"user","content":"1+1=?"}],
    "max_tokens": 32,
    "chat_template_kwargs": {"enable_thinking": false}
  }' | python3 -c "import sys,json;m=json.load(sys.stdin)['choices'][0]['message'];print('content:',m.get('content'));print('reasoning:',m.get('reasoning_content'))"
```

**조치 성공 조건**: `content` 가 non-null 답변, `reasoning_content` 가 null/undefined.

## 7. 참고

- vLLM reasoning parser 문서: https://docs.vllm.ai/en/latest/features/reasoning_outputs/
- EXAONE 4.5 모델 카드: https://huggingface.co/LGAI-EXAONE/EXAONE-4.5-33B-AWQ
- OpenMake 측 client-side workaround: `backend/api/src/llm/stream-parser.ts` (reasoning-channel recovery)

---

## 문의

OpenMake LLM 측 진단 자료 (PM2 로그, curl 캡처, system_fingerprint) 추가 요청 가능.
