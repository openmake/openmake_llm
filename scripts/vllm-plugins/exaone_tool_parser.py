# ============================================================
# exaone_tool_parser.py — vLLM tool-call-parser plugin for EXAONE 4.x
# ============================================================
#
# 목적
#   LG AI Research EXAONE 4.x 모델의 native tool-call format 을
#   vLLM 의 표준 OpenAI 호환 ``tool_calls`` 구조로 변환합니다.
#   vLLM 0.13+ 의 24개 표준 parser 중 어느 것도 EXAONE format 을
#   처리하지 못하기에 별도 plugin 으로 등록합니다.
#
# EXAONE Native Format
#   .. code-block:: text
#
#       <tool_call>function_name
#       <arg_key>k1</arg_key><arg_value>v1</arg_value>
#       <arg_key>k2</arg_key><arg_value>v2</arg_value>
#       </tool_call>
#
#   - 함수 이름은 `<tool_call>` 직후 첫 줄 (newline 으로 종료).
#   - 인자는 `<arg_key>` / `<arg_value>` 쌍 (XML 형제 element).
#   - 한 응답에 다수 `<tool_call>` 블록 가능 (parallel_tool_calls).
#   - chat_template prefix 가 `<think>` 자동 prepend 하므로 reasoning 도
#     함께 etc. → reasoning_parser=deepseek_r1 와 *조합* 사용 권장.
#
# 배포
#   1. 이 파일을 vLLM 호스트에 배치 (예: ``/opt/vllm-plugins/exaone_tool_parser.py``).
#   2. vLLM 기동 인자 추가::
#
#        vllm serve <model_path>/exaone4.5-33b-awq \
#          --port 8001 \
#          --reasoning-parser deepseek_r1 \
#          --tool-call-parser-plugin /opt/vllm-plugins/exaone_tool_parser.py \
#          --tool-call-parser exaone_xml \
#          <기존 인자들...>
#
#   3. 재기동 후 ``scripts/llm-droprate-probe.sh`` 로 검증.
#
# 검증
#   ``pytest scripts/vllm-plugins/test_exaone_tool_parser.py``
#   (vLLM 가 설치된 환경에서 실행 — 우리 백엔드 dev 환경 X, vLLM 호스트 O)
#
# Upstream 기여 경로
#   - 안정화 후 vllm-project/vllm 에 PR 제출
#   - 위치: ``vllm/entrypoints/openai/tool_parsers/exaone_tool_parser.py``
#   - 테스트: ``tests/tool_use/test_chat_completions_with_exaone.py``
#   - 모델 카드 reference: HuggingFace LGAI-EXAONE/EXAONE-4.0
#
# 라이선스
#   본 plugin 은 OpenMake LLM 프로젝트 일부 — 프로젝트 라이선스 따름.
#   upstream merge 시 Apache-2.0 (vLLM 라이선스) 로 dual-license 합의 필요.
# ============================================================

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Sequence
from typing import Any

# vLLM 0.13+ import 경로 — 버전에 따라 미세 변화 가능 시 try/except 로 호환.
try:
    from vllm.entrypoints.openai.tool_parsers.abstract_tool_parser import (
        ToolParser,
        ToolParserManager,
    )
    from vllm.entrypoints.openai.protocol import (
        ChatCompletionRequest,
        DeltaFunctionCall,
        DeltaMessage,
        DeltaToolCall,
        ExtractedToolCallInformation,
        FunctionCall,
        ToolCall,
    )
    from vllm.logger import init_logger
except ImportError as e:  # pragma: no cover — vLLM 부재 환경 (테스트 collection 시점 등)
    raise ImportError(
        "vllm 패키지가 설치되어 있어야 합니다. vLLM 호스트에서만 import 가능."
    ) from e


logger = init_logger(__name__)


# ============================================================
# 정규식 패턴 — 모듈 레벨 컴파일 (스트리밍 성능 보호)
# ============================================================

# `<tool_call>` 부터 `</tool_call>` 까지 — 함수 이름 + body 캡쳐.
# DOTALL 로 줄바꿈 포함, non-greedy.
TOOL_CALL_PATTERN = re.compile(
    r"<tool_call>\s*([^\n<]+?)\s*\n(.*?)</tool_call>",
    re.DOTALL,
)

# `<arg_key>K</arg_key>` `<arg_value>V</arg_value>` 쌍.
ARG_PAIR_PATTERN = re.compile(
    r"<arg_key>(.*?)</arg_key>\s*<arg_value>(.*?)</arg_value>",
    re.DOTALL,
)

# 스트리밍 상태 판정용 — 부분 매칭 (열린 `<tool_call>` 가 닫혔는가?).
TOOL_CALL_OPEN_PATTERN = re.compile(r"<tool_call>", re.IGNORECASE)
TOOL_CALL_CLOSE_PATTERN = re.compile(r"</tool_call>", re.IGNORECASE)


# ============================================================
# 비스트리밍 유틸리티
# ============================================================

def _parse_args_block(body: str) -> dict[str, Any]:
    """`<arg_key>/<arg_value>` 쌍을 dict 로 변환.

    같은 key 가 여러 번 등장하면 *마지막* 값 채택 (보수적).
    빈 body / 매칭 실패 시 빈 dict.
    """
    args: dict[str, Any] = {}
    for key, value in ARG_PAIR_PATTERN.findall(body):
        # 공백 정리만 — value 내용 자체는 trim 하지 않음 (한글 등 의도된 공백 보존).
        args[key.strip()] = value.strip()
    return args


def _generate_tool_call_id() -> str:
    """vLLM 표준 형식의 tool_call id 생성.

    vLLM hermes/openai parser 와 동일한 ``chatcmpl-tool-<24자hex>`` 패턴.
    """
    return f"chatcmpl-tool-{uuid.uuid4().hex[:24]}"


def _extract_all_tool_calls(text: str) -> tuple[list[ToolCall], str]:
    """본문에서 모든 `<tool_call>...</tool_call>` 블록을 추출.

    Returns
    -------
    tool_calls : list[ToolCall]
        OpenAI 호환 ToolCall 객체 리스트.
    remaining_content : str
        tool_call 블록을 제거한 나머지 본문 (assistant content 로 사용).
    """
    tool_calls: list[ToolCall] = []
    for name_match, body_match in TOOL_CALL_PATTERN.findall(text):
        name = name_match.strip()
        if not name:
            continue
        args = _parse_args_block(body_match)
        tool_calls.append(
            ToolCall(
                id=_generate_tool_call_id(),
                type="function",
                function=FunctionCall(
                    name=name,
                    arguments=json.dumps(args, ensure_ascii=False),
                ),
            )
        )
    # 매칭된 블록 제거 → 남은 텍스트가 자연어 content.
    remaining = TOOL_CALL_PATTERN.sub("", text).strip()
    return tool_calls, remaining


# ============================================================
# Plugin 본체
# ============================================================

@ToolParserManager.register_module("exaone_xml")
class ExaoneXmlToolParser(ToolParser):
    """EXAONE 4.x native XML format → 표준 ``tool_calls`` 변환.

    스트리밍은 *burst-emit* 전략을 사용합니다:
      - `<tool_call>` 열림 + 함수 이름 확정 시점에 id + name 한 번 emit
      - 인자 streaming 은 본 plugin 에서 buffer
      - `</tool_call>` 닫힘 시점에 arguments 완성 JSON 한 번 emit
      - tool_call 블록 외 텍스트는 content delta 로 그대로 통과

    이 전략은 hermes_tool_parser 와 동일한 trade-off (각 tool 마다 2회 emit)
    이고, OpenAI 호환 client 가 모두 처리 가능합니다.
    """

    def __init__(self, tokenizer):
        super().__init__(tokenizer)
        # 스트리밍 상태 — *단일 stream 내부에서만 유효*. vLLM 은 본 instance 를
        # OpenAIServingChat 당 한 번 생성하고 여러 요청에 재사용하므로, stream 시작
        # 시점(previous_text=="") 에 반드시 reset 해야 함. _reset_stream_state() 호출.
        self._reset_stream_state()

    def _reset_stream_state(self) -> None:
        """새 stream 진입 시 호출 — 이전 stream 의 잔존 상태 제거.

        vLLM 의 ToolParserManager 가 본 instance 를 *재사용* 하므로, request 경계에서
        명시적으로 리셋하지 않으면 두 번째 요청 이후 ``name_sent_idx`` 가 누적되어
        새 tool_call 의 name/arguments 가 silent drop 됨. extract_tool_calls_streaming
        의 첫 호출 (previous_text=="") 에서 자동 호출됨.
        """
        # current_tool_id: 현재 stream 중인 tool_call 의 0-based index.
        # name_sent_idx: id+name 을 이미 emit 한 tool index 의 set.
        # args_sent_idx: arguments 완성 emit 한 tool index 의 set.
        # prev_content_len: 마지막 emit 한 content 의 누적 길이 — delta 계산용.
        self.current_tool_id: int = -1
        self.name_sent_idx: set[int] = set()
        self.args_sent_idx: set[int] = set()
        self.prev_content_len: int = 0

    # ── 비스트리밍 ─────────────────────────────────────────────

    def extract_tool_calls(
        self, model_output: str, request: ChatCompletionRequest
    ) -> ExtractedToolCallInformation:
        """벌크 응답에서 tool_calls 추출.

        모델 출력에 `<tool_call>` 가 하나도 없으면 ``tools_called=False``,
        원문을 그대로 content 로 반환.
        """
        if "<tool_call>" not in model_output:
            return ExtractedToolCallInformation(
                tools_called=False,
                tool_calls=[],
                content=model_output,
            )

        tool_calls, remaining = _extract_all_tool_calls(model_output)

        if not tool_calls:
            # `<tool_call>` 가 *있긴 하나* 파싱 실패 — malformed.
            logger.warning(
                "EXAONE tool_parser: <tool_call> detected but no valid block parsed. "
                "Returning raw content. output_preview=%r",
                model_output[:200],
            )
            return ExtractedToolCallInformation(
                tools_called=False,
                tool_calls=[],
                content=model_output,
            )

        return ExtractedToolCallInformation(
            tools_called=True,
            tool_calls=tool_calls,
            content=remaining if remaining else None,
        )

    # ── 스트리밍 ───────────────────────────────────────────────

    def extract_tool_calls_streaming(
        self,
        previous_text: str,
        current_text: str,
        delta_text: str,
        previous_token_ids: Sequence[int],
        current_token_ids: Sequence[int],
        delta_token_ids: Sequence[int],
        request: ChatCompletionRequest,
    ) -> DeltaMessage | None:
        """스트리밍 모드 — 매 delta 마다 호출됨.

        반환값:
          - ``DeltaMessage(content=...)`` : tool_call 블록 외 자연어 부분
          - ``DeltaMessage(tool_calls=[DeltaToolCall(...)])`` : tool 시작/완료
          - ``None`` : 아무것도 emit 할 것 없음 (블록 내부 streaming 중)

        설계 원칙
          - 매 호출마다 ``current_text`` 를 *처음부터* 파싱 (간단하고 안전).
          - tool 블록 완성 시점만 식별 → burst emit.
          - 블록 외 텍스트는 prev_content_len 기준으로 delta 만 emit.

        주의 — 알려진 한계
          - 본 instance 는 여러 stream 재사용됨. ``previous_text == ""`` 일 때만
            새 stream 시작으로 간주하여 상태 reset.
          - 부분 prefix 누출 가능: 모델이 `<`, `tool_`, `call>` 를 분할 emit 하면
            첫 두 청크는 자연어 content 로 흘러나옴 (최종 tool_calls 추출은 정상).
            vLLM hermes parser 류와 동일한 UX trade-off — 추후 prefix-buffering 으로
            개선 가능.
        """
        # 0. 새 stream 진입 감지 — vLLM 의 새 요청 신호는 previous_text == "".
        #    이전 요청의 잔존 상태(name_sent_idx 등) 를 명시적으로 정리.
        if not previous_text:
            self._reset_stream_state()

        # 1. 현재까지의 텍스트에서 완성된 tool_call 블록 모두 추출.
        completed_tool_calls, content_so_far = _extract_all_tool_calls(current_text)

        # 2. content delta — 직전 emit 이후 새로 추가된 부분만.
        new_content = content_so_far[self.prev_content_len :]
        self.prev_content_len = len(content_so_far)

        # 3. 새로 완성된 tool_call 식별 — 아직 args 미emit 인 tool.
        deltas: list[DeltaToolCall] = []
        for idx, tc in enumerate(completed_tool_calls):
            # name + id 첫 emit
            if idx not in self.name_sent_idx:
                deltas.append(
                    DeltaToolCall(
                        index=idx,
                        id=tc.id,
                        type="function",
                        function=DeltaFunctionCall(
                            name=tc.function.name,
                            arguments="",  # 비워두고 다음 delta 에서 채움
                        ),
                    )
                )
                self.name_sent_idx.add(idx)

            # arguments 완성 emit (한 번에 통째로 — burst)
            if idx not in self.args_sent_idx:
                deltas.append(
                    DeltaToolCall(
                        index=idx,
                        function=DeltaFunctionCall(
                            arguments=tc.function.arguments,
                        ),
                    )
                )
                self.args_sent_idx.add(idx)

        # 4. 진행 중인 (미완성) tool_call 이 있는지 — 블록은 열렸으나 안 닫힘.
        #    이 경우 delta_text 가 블록 내부 토큰이면 content emit 하면 안 됨.
        open_count = len(TOOL_CALL_OPEN_PATTERN.findall(current_text))
        close_count = len(TOOL_CALL_CLOSE_PATTERN.findall(current_text))
        inside_unclosed_block = open_count > close_count

        # 5. emit 조합.
        if deltas:
            # tool_call 새로 완성 — content 도 같이 있으면 함께 emit.
            return DeltaMessage(
                content=new_content if new_content else None,
                tool_calls=deltas,
            )

        if new_content and not inside_unclosed_block:
            # 자연어 content delta — 미완성 블록 내부가 아닐 때만.
            return DeltaMessage(content=new_content)

        # 미완성 블록 내부에서 토큰이 흘러나옴 — 외부로 emit 하지 않음 (버퍼링).
        return None


# ============================================================
# 호환성 메모
# ============================================================
#
# - vLLM 0.13+ : 본 plugin 의 import 경로와 시그니처가 표준.
# - vLLM 0.7-0.12 : ToolParserManager 위치 다를 수 있음 — 필요 시
#   ``from vllm.entrypoints.openai.tool_parsers import ToolParser`` 시도.
# - vLLM <0.7 : tool-call-parser 시스템 자체 부재 — upgrade 필요.
#
# 호환 검증 명령::
#
#     python -c "from vllm.entrypoints.openai.tool_parsers.abstract_tool_parser import ToolParser; print('ok')"
#
# 실패 시 vLLM 의 ``__init__.py`` 에서 ToolParser 위치 확인 후 import 경로 수정.
# ============================================================
