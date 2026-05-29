# LiteLLM/vLLM 서버 정합성 점검 & 동기화 작업 정리

작업일: 2026-05-29
대상 서버: `http://rockyhan.duckdns.org:13401/` (LiteLLM Proxy v1.86.2)

---

## 1. 배경 / 목적

운영 LLM 백엔드(LiteLLM Proxy)의 내용을 검토하고, `openmake_llm` 저장소가
실제 서버 배포와 정합하게 개발되어 있는지 점검 후 동기화.

서버 진단은 SSH(`smith@rockyhan.duckdns.org:13022`)로 read-only 명령 실행 +
LiteLLM 인증 API(`/model/info`, `/v1/models`)로 실측 데이터 확보. 추측 없이 전사.

---

## 2. 실측으로 확인된 서버 토폴로지

| 구성요소 | 실제 값 |
|---|---|
| LiteLLM | `:13401` 직접 바인딩 (리버스 프록시 없음), config=`/home/smith/vllm/litellm.config.yaml` |
| vLLM qwen3.6-35b-a3b | `:8002` (262K), venv `/home/smith/vllm/rebuild/vllm_env`, 가중치 `/home/smith/models/qwen3.6-35b-a3b-fp8` |
| vLLM qwen3.6-35b-a3b-1m | `:8004` (1M, YARN rope), 동일 venv/가중치 |
| vLLM bge-m3 | `:8003` (embedding, pooling), venv `/home/smith/vllm/vllm_env` |
| 기동 방식 | **systemd 미사용** (tmux 추정), 유저 `smith`, repo=`/home/smith/openmake_llm` |
| EXAONE | **미배포** (라이브에 없음) |

**버전**: vLLM `0.22.0rc3`(qwen) / `0.21.1rc1.dev`(bge), LiteLLM `1.86.2`,
Python 3.12.3, torch 2.11.0+cu130, transformers 5.8.1.
코드는 "vLLM 0.21+" 가정 → 충족.

---

## 3. 발견된 불일치 (점검 결과)

1. **모델명 미스매치** — 저장소 `scripts/vllm/`는 구식(`qwen2.5-7b`/`exaone`),
   실서버는 `qwen3.6-35b-a3b` 계열. → 동기화 완료
2. **gemma-4-31b** — 코드(`local-models.ts`)엔 있으나 서버 미배포. → 제거
3. **EXAONE** — 서버 미배포인데 코드/스크립트에 전반적으로 잔존. → 전부 제거
4. **LiteLLM DB 미연결** — `/health/readiness` → `db: Not connected` (별개 이슈, 미조치)
5. **포트/유저/경로 불일치** — 서비스 파일이 `openmake`/`/opt/openmake_llm`/`:4000`
   (실제는 `smith`/`/home/smith`/`:13401`). → 갱신

---

## 4. 수행한 변경 (코드/저장소)

### A. gemma-4-31b 제거
- `backend/api/src/config/local-models.ts` — 카탈로그 entry + 주석
- `backend/api/src/config/model-defaults.ts` — `'gemma-4'` 프리셋 (`'gemma4'` e4b 유지)
- `.env.example` — 예시 JSON 라인

### B. scripts/vllm 동기화 (실측 기반)
- `litellm.config.yaml` — qwen3.6-35b-a3b(8002)/-1m(8004)/bge-m3(8003)/gpt-3.5 alias
- `qwen-serve.sh` — 262K @8002 (qwen3 reasoning-parser, qwen3_coder tool-parser, fp8, speculative mtp)
- `qwen-1m-serve.sh` — **신규** 1M @8004 (YARN rope hf-overrides)
- `bge-m3-serve.sh` — **신규** embedding @8003 (pooling)
- `openmake-vllm-qwen.service` / `-qwen-1m.service`(신규) / `-bge.service`(신규) / `openmake-litellm.service`
  — User=smith, 실제 venv PATH, :13401 반영
- `exaone-serve.sh` + `openmake-vllm-exaone.service` — **삭제**

### C. EXAONE 코드 refs 전부 제거
- 삭제: `scripts/vllm-plugins/exaone_tool_parser.py` + `test_exaone_tool_parser.py`
- 코드 제거: `model-defaults.ts`(exaone4.5 프리셋), `llm-parameters.ts`(EXAONE_45_* 4종),
  `model-selector.ts`(EXAONE 샘플링 분기 → `_modelName` 시그니처 보존)
- 주석 교체(로직 보존, Qwen3로): `stream-parser.ts`, `reasoning-adapter.ts`,
  `reasoning-tag-parser.ts`, `types.ts`, `env.schema.ts`, `sequential-thinking.ts`,
  `provider-router.ts`, `i-provider.ts`, `.env.example`, `llm-droprate-probe.sh`
- stale 버그 수정: `OpenAICompatService.ts` "현 default exaone4.5" → qwen3.6
- ⚠️ reasoning_content/enable_thinking/reasoning-parser 인프라는 **Qwen3가 사용 중**이라 보존

### D. 문서 정정
- `CLAUDE.md` — 배포 가이드 라인 (deleted exaone-serve.sh 참조 + 포트/유닛 갱신)
- `.env.example` — 토폴로지/quick-start 주석 갱신

---

## 5. 검증 결과

- 비-테스트 코드 EXAONE/gemma 잔여: **0건**
- TypeScript 타입체크(`tsc --noEmit`): **에러 0건**
- bash 문법 / 임베디드 JSON / litellm config 구조: OK
- **end-to-end 실측 (LiteLLM :13401 경유):**
  - chat (thinking off) → content "2", reasoning_content 없음, clean stop ✅
  - chat (thinking on) → reasoning_content 427자 분리 + content "5" ✅
  - embedding bge-m3 → 1024-dim ✅

---

## 6. 남은 작업 (운영자 직접 조치)

1. 🔴 **LiteLLM config 서버 복사** — 동기화한 `scripts/vllm/litellm.config.yaml`을
   서버 `/home/smith/vllm/litellm.config.yaml`로 복사 + LiteLLM 재기동해야 반영됨
2. **커밋/푸시** — ✅ 코드 변경 커밋 완료 (`4c30f19` Qwen-1M/BGE-M3 지원, `7fb2dc8`). 원격 push 여부는 운영자 판단.
3. ❓ **LiteLLM DB 미연결** — 의도 여부 확인 권장 (자체 추적 사용 중이면 무방)
4. ❓ **systemd 미사용** — 갱신한 `.service`는 향후 도입 시 reference (현재 tmux 추정)
5. ⚠️ vLLM 0.22.0rc3은 RC + venv 버전 skew(0.22 vs 0.21) — 안정성 민감 시 통일/GA 대기 고려

---

## 7. 변경 파일 요약

```
수정 17 · 신규 4 · 삭제 5

신규: scripts/vllm/{qwen-1m-serve.sh, bge-m3-serve.sh,
                    openmake-vllm-qwen-1m.service, openmake-vllm-bge.service}
삭제: scripts/vllm/{exaone-serve.sh, openmake-vllm-exaone.service},
      scripts/vllm-plugins/{exaone_tool_parser.py, test_exaone_tool_parser.py}
```

> 코드/저장소 변경은 커밋 완료 (`4c30f19`, `7fb2dc8`). 본 문서는 완료된 작업 로그이며, repo 루트 정리 시 docs/ 아카이브 이동 또는 삭제 후보.
