# fixture 출처 (PR-3.1)

이 폴더의 JSON 은 **서버 소스에서 재구성한 실제 응답 형상 + 합성 값**이다. 서버를 실행해 수집한 값이 아니다.
ID·문자열·시각은 모두 합성(`*-synth-*`, `tok_SYNTH`, `viewer.invalid` 등)이며 실제 키·토큰·서버 주소·사용자 경로가 없다.

- 기준 서버 SHA: `8cbf1e4a0e64c299c298cac7b23bbc7fdc7ce4fc` (origin/dev, #1887)
- envelope: `apps/api/src/utils/api-response.ts:91` `success()` → `{success:true, data, meta}`,
  `:105` `error()` → `{success:false, error:{code,message,details?}, meta}`. 모든 fixture 가 이 envelope 를 쓴다.
- 작업 행: `apps/api/src/routes/agent-task.helpers.ts:123` `toPublicTask`(checkpoint·input_images·create_idempotency_key·lease_* 제거,
  resumable 산출, queuePosition), 컬럼 `apps/api/src/data/models/unified-database.types.ts:123` `AgentTask`,
  격리 `packages/shared-types/src/agent-task-isolation.ts:1`. 스텝 행 `unified-database.types.ts:188` `AgentTaskStep`.

| fixture | 서버 근거 (파일:줄 / 심볼) | 사용 필드 |
|---|---|---|
| create_201.json | `routes/agent-task.routes.ts:216` 201 `success({task, concurrentActive, warnings})` | task.(id,status,goal,progress,executor,device_id,folder_rel,created_at,updated_at,resumable,isolation), concurrentActive, warnings |
| create_200_dedup.json | `agent-task.routes.ts:134`, `:208` 200 `deduplicated:true` | 위 + deduplicated, 서버 status(running) 그대로 |
| create_201_task_null.json | `agent-task.routes.ts:217` `task ? toPublicTask(task) : task` — null 가능 | task:null → Decode |
| create_409.json | `agent-task.routes.ts:133`, `:206` 409 `conflict(...)` | error.code/message |
| get_task.json | `agent-task.routes.ts:254` `success(detailPayload)`, `routes/agent-task-chain.ts:91` `{task:{...,waitReason,chain}, steps}` | task(+isolation worktree), steps[].(step_number,step_type,tool_name,content,created_at) |
| list_tasks.json | `agent-task.routes.ts:242` `success({tasks, total})` | tasks[], total; isolation direct+reason |
| list_steps.json | `agent-task.routes.ts:266` `success({steps, total})` | steps[], total (diff 스텝 = step_type diff + content) |
| list_subagents.json | `routes/agent-task-subagent.routes.ts:88` `success({traces})`, `groupSubagentSteps` (:60-81) | traceId,origin,subIndex,label,status,startedAt,finishedAt,steps[].(seq,type,tool,content,at) |
| execute_202.json | `agent-task.routes.ts:342` 202 `{message,taskId,queued}` | 전부 |
| resume_202_queued.json | `agent-task.routes.ts:416` 202 `{message,taskId,queued}` | 전부(queued:true) |
| auto_approve.json | `routes/agent-task-approvals.routes.ts:88` `{taskId, autoApprove}` | 전부 |
| pending.json | `agent-task-approvals.routes.ts:97` `{pending}`, `services/task-sandbox/approval-gate.ts:131-147` `PendingApproval`, `apps/cli/src/ask-human.ts:4-5,31-55` 질문은 args.question/questions | approvalId,taskId,userId,toolName,args(object, opaque),createdAt(epoch ms),riskClass(미지 값 보존),sensitive,preview?,assigneeUserId? |
| decision.json | `agent-task-approvals.routes.ts:210` `{approvalId, decision, resumed}` | 전부 |
| answer.json | `agent-task-approvals.routes.ts:188` `{approvalId, answered, resumed}` | 전부 |
| share_get.json | `routes/agent-task-share.routes.ts:110` `{share:{shareId,visibility,shareToken,include*,sharedAt,path}}` | 전부 |
| share_get_null.json | 같은 줄 — 공유 없음 `share:null` | share |
| share_preview.json | `agent-task-share.routes.ts:132` `{preview}`, `services/agent-task/share-document.ts:59` `ShareDocument`, `:76` `ShareArtifact` | 문서 전 필드 |
| share_publish.json | `agent-task-share.routes.ts:184` `{shareId,visibility,shareToken,path}` — include* 없음(CLI ShareState 와 다름) | 전부 |
| shared_task.json | `agent-task-share.routes.ts:224` `{shareId,visibility,sharedAt,document}` | 전부 |
| artifact_open.json | `agent-task-share.routes.ts:256` `{url}` (TTL 접근 토큰 포함 — 반환만, 열지 않음) | url |
| unshare.json | `agent-task-share.routes.ts:202` `{unshared}` | unshared |
| bridge_status.json | `routes/local-bridge.routes.ts:21` `{enabled,connected,label,folderName,devices[]}` | enabled,connected,devices[].(deviceId,hostId,label,folderName,connectedAt) — 최상위 label/folderName 구 필드는 읽지 않음 |
| folders.json | `local-bridge.routes.ts:67` `{deviceId,path,folders[{rel,name}],truncated}` | 전부 |

## 서버 회귀 테스트 근거 (실행하지 않음 — 형상 근거 연결용)

- `apps/api/src/services/agent-task/__tests__/create-idempotency.test.ts:1-3` — 같은 Idempotency-Key 재요청은 처음 작업 반환(사용자 분리·재시작).
- `apps/api/src/routes/__tests__/agent-task-execute-claim.routes.test.ts:79` — 큐 duplicate → 400(실행 중 재실행 거절).
- `apps/api/src/routes/__tests__/agent-task-approvals-park.routes.test.ts:37,46` — answer/approve/reject 응답의 resumed.
- `apps/api/src/__tests__/services/agent-task/share-document.test.ts:33,89,109` — 공유 문서 선별·토글·캡(정화 문서).

## 미문서 계약

작업 생성 POST 외 18개 operation 과 생성 응답의 추가 task 필드는 OpenAPI 에 없다. 정확한 예외 목록은
`tests/contracts/exceptions-*.json`(사유·서버 근거·소비 PR·U-10), 문서 대조 목록은 `tests/contracts/fields.json`.
