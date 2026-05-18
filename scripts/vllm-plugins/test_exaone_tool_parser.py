# ============================================================
# test_exaone_tool_parser.py — pytest suite
# ============================================================
#
# 실행 환경
#   vLLM 가 설치된 호스트에서 실행 — 우리 백엔드 dev 환경에서는 X.
#   ``pip install vllm pytest`` 후::
#
#       pytest scripts/vllm-plugins/test_exaone_tool_parser.py -v
#
# 커버리지
#   - 비스트리밍: 정상/다중/한글/malformed/혼합 텍스트
#   - 스트리밍: 누적 호출, 부분 토큰, content+tool 혼합
#   - 엣지 케이스: 빈 인자, 중복 key, unicode, escape
# ============================================================

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

# vLLM 가 없는 환경에서는 collection-time skip.
vllm = pytest.importorskip("vllm")

from exaone_tool_parser import ExaoneXmlToolParser  # noqa: E402


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def parser() -> ExaoneXmlToolParser:
    """벌크 호출간 영속 상태 없는 새 인스턴스."""
    tokenizer = MagicMock()
    return ExaoneXmlToolParser(tokenizer)


@pytest.fixture
def request_stub() -> Any:
    """vLLM ChatCompletionRequest 의 최소 stub — 본 parser 는 request 미사용."""
    return MagicMock()


# ============================================================
# 비스트리밍 — extract_tool_calls
# ============================================================

def test_single_tool_call(parser, request_stub):
    """가장 기본: 단일 함수, 단일 인자."""
    output = (
        "<tool_call>get_weather\n"
        "<arg_key>city</arg_key><arg_value>Seoul</arg_value>\n"
        "</tool_call>"
    )
    info = parser.extract_tool_calls(output, request_stub)

    assert info.tools_called is True
    assert len(info.tool_calls) == 1
    tc = info.tool_calls[0]
    assert tc.function.name == "get_weather"
    assert json.loads(tc.function.arguments) == {"city": "Seoul"}
    assert tc.id.startswith("chatcmpl-tool-")
    assert info.content is None


def test_single_tool_call_korean(parser, request_stub):
    """한글 인자 값 — ensure_ascii=False 검증."""
    output = (
        "<tool_call>get_weather\n"
        "<arg_key>city</arg_key><arg_value>서울</arg_value>\n"
        "</tool_call>"
    )
    info = parser.extract_tool_calls(output, request_stub)

    assert info.tools_called is True
    args = json.loads(info.tool_calls[0].function.arguments)
    assert args == {"city": "서울"}
    # ensure_ascii=False 보장 — raw arguments string 에 한글 그대로 보임
    assert "서울" in info.tool_calls[0].function.arguments


def test_multiple_parallel_calls(parser, request_stub):
    """parallel_tool_calls — 한 응답에 다수 함수."""
    output = (
        "<tool_call>get_weather\n"
        "<arg_key>city</arg_key><arg_value>Seoul</arg_value>\n"
        "</tool_call>\n"
        "<tool_call>get_weather\n"
        "<arg_key>city</arg_key><arg_value>Busan</arg_value>\n"
        "</tool_call>"
    )
    info = parser.extract_tool_calls(output, request_stub)

    assert info.tools_called is True
    assert len(info.tool_calls) == 2
    cities = [json.loads(tc.function.arguments)["city"] for tc in info.tool_calls]
    assert cities == ["Seoul", "Busan"]
    # 각 id 가 unique
    assert info.tool_calls[0].id != info.tool_calls[1].id


def test_multiple_args(parser, request_stub):
    """단일 함수, 여러 인자 — 순서 보존 + 모든 key/value 추출."""
    output = (
        "<tool_call>search\n"
        "<arg_key>query</arg_key><arg_value>vLLM</arg_value>\n"
        "<arg_key>limit</arg_key><arg_value>10</arg_value>\n"
        "<arg_key>sort_by</arg_key><arg_value>relevance</arg_value>\n"
        "</tool_call>"
    )
    info = parser.extract_tool_calls(output, request_stub)

    args = json.loads(info.tool_calls[0].function.arguments)
    assert args == {"query": "vLLM", "limit": "10", "sort_by": "relevance"}


def test_no_tool_call(parser, request_stub):
    """plain text 응답 — tools_called=False, 원문 그대로."""
    output = "오늘은 맑은 날씨입니다. 외출하기 좋겠네요."
    info = parser.extract_tool_calls(output, request_stub)

    assert info.tools_called is False
    assert info.tool_calls == []
    assert info.content == output


def test_content_before_tool_call(parser, request_stub):
    """reasoning 또는 prefix 텍스트가 tool_call 앞에 있을 때."""
    output = (
        "사용자의 요청을 분석한 결과 날씨 조회가 필요합니다.\n"
        "<tool_call>get_weather\n"
        "<arg_key>city</arg_key><arg_value>Seoul</arg_value>\n"
        "</tool_call>"
    )
    info = parser.extract_tool_calls(output, request_stub)

    assert info.tools_called is True
    assert info.content is not None
    assert "사용자의 요청을 분석" in info.content


def test_content_after_tool_call(parser, request_stub):
    """tool_call 뒤에 자연어 — 두 부분 다 살아남는가."""
    output = (
        "<tool_call>get_weather\n"
        "<arg_key>city</arg_key><arg_value>Seoul</arg_value>\n"
        "</tool_call>\n"
        "위 함수로 날씨를 조회하겠습니다."
    )
    info = parser.extract_tool_calls(output, request_stub)

    assert info.tools_called is True
    assert info.content is not None
    assert "위 함수로" in info.content


def test_malformed_no_close_tag(parser, request_stub):
    """열림은 있으나 닫힘 없음 — malformed, 원문 fallback."""
    output = (
        "<tool_call>get_weather\n"
        "<arg_key>city</arg_key><arg_value>Seoul</arg_value>"
        # </tool_call> 누락
    )
    info = parser.extract_tool_calls(output, request_stub)

    # malformed 는 tools_called=False, content=원문 fallback
    assert info.tools_called is False
    assert info.content == output


def test_malformed_empty_name(parser, request_stub):
    """함수 이름 비어있음 — skip 후 valid 만 추출 (있으면)."""
    output = "<tool_call>\n<arg_key>x</arg_key><arg_value>1</arg_value>\n</tool_call>"
    info = parser.extract_tool_calls(output, request_stub)

    # 빈 이름은 valid tool 로 간주하지 않음
    assert info.tools_called is False


def test_empty_args_block(parser, request_stub):
    """인자 없는 함수 호출 — 빈 dict 인자."""
    output = "<tool_call>get_time\n</tool_call>"
    info = parser.extract_tool_calls(output, request_stub)

    assert info.tools_called is True
    args = json.loads(info.tool_calls[0].function.arguments)
    assert args == {}


def test_duplicate_keys_last_wins(parser, request_stub):
    """같은 key 반복 — 마지막 값 채택 (보수적 결정)."""
    output = (
        "<tool_call>set\n"
        "<arg_key>x</arg_key><arg_value>first</arg_value>\n"
        "<arg_key>x</arg_key><arg_value>second</arg_value>\n"
        "</tool_call>"
    )
    info = parser.extract_tool_calls(output, request_stub)
    args = json.loads(info.tool_calls[0].function.arguments)
    assert args == {"x": "second"}


def test_special_chars_in_value(parser, request_stub):
    """값 안에 특수문자 — JSON escape 가 정상 작동하는가."""
    output = (
        '<tool_call>echo\n'
        '<arg_key>text</arg_key><arg_value>line1\nline2 "quoted"</arg_value>\n'
        '</tool_call>'
    )
    info = parser.extract_tool_calls(output, request_stub)
    # raw arguments 는 JSON-encoded string
    args = json.loads(info.tool_calls[0].function.arguments)
    assert args["text"] == 'line1\nline2 "quoted"'


# ============================================================
# 스트리밍 — extract_tool_calls_streaming
# ============================================================

def _stream_chunks(parser, request_stub, chunks: list[str]):
    """헬퍼: 점진적 누적 호출로 streaming emit 시뮬레이션.

    각 청크는 directly 추가됨 — 실제 vLLM 동작 모사.
    """
    accumulated = ""
    deltas = []
    for chunk in chunks:
        previous = accumulated
        accumulated += chunk
        result = parser.extract_tool_calls_streaming(
            previous_text=previous,
            current_text=accumulated,
            delta_text=chunk,
            previous_token_ids=[],
            current_token_ids=[],
            delta_token_ids=[],
            request=request_stub,
        )
        if result is not None:
            deltas.append(result)
    return deltas


def test_streaming_single_call(parser, request_stub):
    """청크 단위로 들어와도 최종 tool_call 정상 emit."""
    chunks = [
        "<tool_",
        "call>get_weather\n<arg_key>city",
        "</arg_key><arg_value>Seoul</arg_value>\n",
        "</tool_call>",
    ]
    deltas = _stream_chunks(parser, request_stub, chunks)

    # 마지막 청크에서 burst emit — name + arguments 둘 다.
    tool_emits = [d for d in deltas if d.tool_calls]
    assert len(tool_emits) >= 1, "tool_call 이 한 번 이상 emit 되어야 함"

    # 마지막 emit 에서 arguments 가 JSON 완성형
    all_arg_text = ""
    for d in tool_emits:
        for tc in d.tool_calls or []:
            if tc.function and tc.function.arguments:
                all_arg_text += tc.function.arguments
    args = json.loads(all_arg_text)
    assert args == {"city": "Seoul"}


def test_streaming_content_then_tool(parser, request_stub):
    """content 가 먼저 흐르고 tool_call 이 뒤에 오는 케이스."""
    chunks = [
        "사용자 요청 분석 중. ",
        "이제 도구를 호출합니다. ",
        "<tool_call>get_weather\n",
        "<arg_key>city</arg_key><arg_value>Seoul</arg_value>\n",
        "</tool_call>",
    ]
    deltas = _stream_chunks(parser, request_stub, chunks)

    # content delta 가 첫 두 청크에서 흘러야 함
    content_emits = [d for d in deltas if d.content]
    assert len(content_emits) >= 1
    all_content = "".join(d.content or "" for d in content_emits)
    assert "사용자 요청 분석 중" in all_content
    assert "이제 도구를 호출합니다" in all_content

    # tool_call 도 한 번 이상 emit
    tool_emits = [d for d in deltas if d.tool_calls]
    assert len(tool_emits) >= 1


def test_streaming_no_emit_inside_unclosed_block(parser, request_stub):
    """미완성 `<tool_call>` 블록 내부에서는 emit 하지 않음 (버퍼링)."""
    # `<tool_call>` 까지만 — 아직 안 닫힘
    deltas = _stream_chunks(parser, request_stub, [
        "<tool_call>get_weather\n",
        "<arg_key>city</arg_key>",
        # <arg_value> 도착 안 함
    ])
    # 어떤 emit 도 발생하지 않아야 함 — 미완성 블록 내부
    assert all(d.content is None and not d.tool_calls for d in deltas), (
        f"unclosed 블록 내부에서 emit 발생: {deltas}"
    )


def test_streaming_resumes_after_block(parser, request_stub):
    """tool_call 완료 후 자연어 content 가 따라오면 정상 emit."""
    chunks = [
        "<tool_call>get_weather\n<arg_key>city</arg_key><arg_value>Seoul</arg_value>\n</tool_call>",
        "\n조회를 시작합니다.",
    ]
    deltas = _stream_chunks(parser, request_stub, chunks)

    # tool_call emit 1회 이상
    tool_emits = [d for d in deltas if d.tool_calls]
    assert len(tool_emits) >= 1

    # 뒤 content emit 도 발생
    later_content = "".join(d.content or "" for d in deltas if d.content)
    assert "조회를 시작합니다" in later_content


# ============================================================
# 회귀 — 실제 캡처된 EXAONE 응답 사례
# ============================================================

def test_real_capture_failure_mode_1(parser, request_stub):
    """2026-05-18 캡처: native XML emit → vLLM default parser drop 케이스.

    Plugin 도입 후 동일 input 으로 tool_calls 가 *정상* 추출되어야 함.
    """
    # 실제 캡처 형식 (단순화)
    captured = (
        "사용자가 서울 날씨를 요청했으므로 get_weather 호출이 필요합니다.\n"
        "</think>\n"
        "<tool_call>get_weather\n"
        "<arg_key>city</arg_key><arg_value>서울</arg_value>\n"
        "</tool_call>"
    )
    info = parser.extract_tool_calls(captured, request_stub)

    assert info.tools_called is True
    assert len(info.tool_calls) == 1
    assert info.tool_calls[0].function.name == "get_weather"
    args = json.loads(info.tool_calls[0].function.arguments)
    assert args["city"] == "서울"


def test_real_capture_failure_mode_2(parser, request_stub):
    """2026-05-19 캡처: 모델이 호출 의도만 진술 후 자연어 마감 케이스.

    이 케이스는 plugin 도입과 무관 — *모델 자체* 가 marker 를 안 만들었으므로
    tools_called=False 가 맞음. (UX/플로우 측면에선 별도 fallback 필요.)
    """
    captured = (
        "사용자가 서울 날씨를 요청하고 있습니다. get_weather 함수를 호출해야 합니다.\n"
        "</think>\n"
        "서울의 현재 날씨를 확인해드릴게요."
    )
    info = parser.extract_tool_calls(captured, request_stub)

    # marker 없음 → tools_called False — *기대된 동작*.
    assert info.tools_called is False
    assert info.content == captured


# ============================================================
# 회귀 — instance 재사용 (advisor 지적 사항)
# ============================================================

def _stream_full(parser, request_stub, full_text: str, chunk_size: int = 20):
    """헬퍼: 단일 stream 을 청크로 쪼개 누적 호출. 모든 delta 반환."""
    deltas = []
    accumulated = ""
    for offset in range(0, len(full_text), chunk_size):
        chunk = full_text[offset : offset + chunk_size]
        previous = accumulated
        accumulated += chunk
        result = parser.extract_tool_calls_streaming(
            previous_text=previous,
            current_text=accumulated,
            delta_text=chunk,
            previous_token_ids=[],
            current_token_ids=[],
            delta_token_ids=[],
            request=request_stub,
        )
        if result is not None:
            deltas.append(result)
    return deltas


def test_streaming_instance_reuse_two_sequential_streams(parser, request_stub):
    """vLLM 은 parser instance 를 *재사용* — 두 번째 stream 도 정상 emit 되어야 함.

    Advisor 지적: ``__init__`` 의 인스턴스 상태(name_sent_idx 등) 가 reset 되지 않으면
    두 번째 stream 의 tool_call 이 silently drop. ``_reset_stream_state()`` 가
    ``previous_text == ""`` 시점에 자동 호출되는지 회귀 검증.
    """
    stream_text = (
        "<tool_call>get_weather\n"
        "<arg_key>city</arg_key><arg_value>Seoul</arg_value>\n"
        "</tool_call>"
    )

    # ── Stream #1 ──
    deltas_1 = _stream_full(parser, request_stub, stream_text)
    tool_emits_1 = [d for d in deltas_1 if d.tool_calls]
    assert len(tool_emits_1) >= 1, "Stream #1 에서 tool_call emit 누락"

    args_1 = "".join(
        tc.function.arguments
        for d in tool_emits_1
        for tc in (d.tool_calls or [])
        if tc.function and tc.function.arguments
    )
    assert json.loads(args_1) == {"city": "Seoul"}, "Stream #1 arguments 부정확"

    # ── Stream #2: 같은 parser instance 로 새 stream ──
    # 두 번째 호출에서 reset 이 작동하지 않으면 tool_call 이 emit 안 됨.
    deltas_2 = _stream_full(parser, request_stub, stream_text)
    tool_emits_2 = [d for d in deltas_2 if d.tool_calls]
    assert len(tool_emits_2) >= 1, (
        "Stream #2 에서 tool_call emit 누락 — instance 상태 reset 실패 "
        "(advisor 지적 사항)"
    )

    args_2 = "".join(
        tc.function.arguments
        for d in tool_emits_2
        for tc in (d.tool_calls or [])
        if tc.function and tc.function.arguments
    )
    assert json.loads(args_2) == {"city": "Seoul"}, "Stream #2 arguments 부정확"


def test_streaming_instance_reuse_three_streams_with_different_args(parser, request_stub):
    """3 회 연속 stream — 인자 값이 매번 달라도 모두 정상 추출."""
    cities = ["Seoul", "Busan", "Daegu"]
    for city in cities:
        stream_text = (
            f"<tool_call>get_weather\n"
            f"<arg_key>city</arg_key><arg_value>{city}</arg_value>\n"
            f"</tool_call>"
        )
        deltas = _stream_full(parser, request_stub, stream_text)
        tool_emits = [d for d in deltas if d.tool_calls]
        assert len(tool_emits) >= 1, f"city={city} stream 에서 tool_call 누락"

        args_text = "".join(
            tc.function.arguments
            for d in tool_emits
            for tc in (d.tool_calls or [])
            if tc.function and tc.function.arguments
        )
        assert json.loads(args_text) == {"city": city}, (
            f"city={city}: 누적 상태 오염 가능성"
        )


def test_streaming_prev_content_len_reset(parser, request_stub):
    """prev_content_len 도 stream 마다 reset 되어야 함 — 안 되면 두 번째 stream 의
    content delta 가 first stream 길이만큼 잘려나감.
    """
    # Stream #1: tool_call 만 (content 없음)
    _stream_full(parser, request_stub, "<tool_call>x\n</tool_call>")
    # 이 시점 prev_content_len 은 reset 안 되면 비-0 일 수 있음.

    # Stream #2: 짧은 content + tool_call.
    deltas = _stream_full(parser, request_stub, "안녕하세요. <tool_call>x\n</tool_call>")
    content_emits = [d for d in deltas if d.content]
    all_content = "".join(d.content or "" for d in content_emits)
    assert "안녕하세요" in all_content, (
        "Stream #2 content delta 가 잘림 — prev_content_len reset 실패"
    )
