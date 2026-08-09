#!/usr/bin/env python3
"""
AI 트렌드 데일리 리포트 렌더러 — 고정 디자인 템플릿에 data.json 값만 치환.

디자인(HTML/CSS/구조)은 절대 바뀌지 않는다. LLM 은 데이터(data.json)만 생성하고,
이 스크립트가 {{TOKEN}} 을 결정적으로 치환해 report.html 을 만든다 → OD 템플릿 픽셀-정합.

뉴스는 개수 고정 슬롯이 아니라 `news` 배열로 받아 지역별로 분류·반복 렌더한다.
템플릿의 <!-- REPEAT:NAME --> ~ <!-- /REPEAT --> 블록이 항목 수만큼 복제되므로,
조사한 기사가 몇 건이든 유실되지 않는다(구 NEWS1~3 고정 슬롯은 초과분이 조용히 버려졌다).

사용:
  python3 render_report.py --keys              # 채워야 할 토큰(키) 목록 출력
  python3 render_report.py data.json report.html
"""
import sys, json, re, os, html, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(BASE, "ai-trend-daily.html")
# 컨테이너 로케일은 UTC 라 07:00 KST 실행 시 로컬 날짜가 전날이 된다 → 리포트 기준 TZ 를 명시.
REPORT_TZ = os.environ.get("REPORT_TZ", "Asia/Seoul")
TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
REPEAT_RE = re.compile(
    r"[ \t]*<!-- REPEAT:([A-Z0-9_]+) -->\n?(.*?)[ \t]*<!-- /REPEAT -->\n?",
    re.DOTALL,
)

# 반복 그룹 정의 — 그룹명: 그룹에 넣을 region 값
NEWS_SOURCE_KEY = "news"
GROUPS = {
    "NEWS_DOMESTIC": "국내",
    "NEWS_GLOBAL": "국외",
}
EMPTY_CARD = '<div class="news-empty">해당 지역의 신규 기사를 확보하지 못했습니다.</div>'
# 짧은 라벨 자리의 길이 상한 — 배지가 길어지면 헤더 그리드에서 제목 컬럼을 밀어낸다.
# CSS 가 아니라 데이터 단에서 자르므로 어떤 값이 와도 레이아웃이 보장된다.
MAX_LEN = {"HEADLINE_TAG": 24}


def computed():
    """LLM 이 아니라 렌더러가 결정하는 값 — 모델이 기사 날짜를 실행일로 착각하는 것을 차단."""
    try:
        from zoneinfo import ZoneInfo
        now = datetime.datetime.now(ZoneInfo(REPORT_TZ))
    except Exception:
        # tzdata 부재 등 — UTC 로컬시간을 그대로 쓰면 날짜가 어긋나므로 실패를 드러낸다.
        print(f"경고 — 타임존 '{REPORT_TZ}' 로드 실패, 로컬시간 사용", file=sys.stderr)
        now = datetime.datetime.now()
    return {"RUN_DATE": now.strftime("%Y-%m-%d")}


def esc(v):
    """LLM 이 만든 문자열이 마크업으로 해석되지 않게 이스케이프(공개 URL 로 서빙됨)."""
    return html.escape(str(v), quote=True)


def blocks(tpl):
    """템플릿의 반복 블록 {그룹명: 블록 HTML}."""
    return {m.group(1): m.group(2) for m in REPEAT_RE.finditer(tpl)}


def scalar_tokens(tpl):
    """반복 블록 밖의 스칼라 토큰(등장 순서 유지, 중복 제거)."""
    outside = REPEAT_RE.sub("", tpl)
    seen, out = set(), []
    for m in TOKEN_RE.finditer(outside):
        if m.group(1) not in seen:
            seen.add(m.group(1)); out.append(m.group(1))
    return out


def render_group(block, items):
    """블록을 항목 수만큼 복제 — {{ITEM_FIELD}} 를 항목의 field 값으로 치환."""
    if not items:
        return EMPTY_CARD
    out = []
    for it in items:
        chunk = block
        for tok in set(TOKEN_RE.findall(block)):
            if not tok.startswith("ITEM_"):
                continue
            chunk = chunk.replace("{{" + tok + "}}", esc(it.get(tok[5:].lower(), "—")))
        out.append(chunk)
    return "".join(out)


def main():
    tpl = open(TPL, encoding="utf-8").read()
    ks = scalar_tokens(tpl)
    if "--keys" in sys.argv:
        # 카운트·날짜 토큰은 렌더러가 계산하므로 LLM 이 채울 대상에서 제외.
        auto = set(computed())
        print("\n".join(k for k in ks if not k.endswith("_COUNT") and k not in auto))
        print(f"\n[{NEWS_SOURCE_KEY}] 배열 — 조사한 기사를 건수 제한 없이 모두 담는다. "
              f"항목 필드: region(국내|국외) · src · date · title · desc")
        return

    data_path = sys.argv[1] if len(sys.argv) > 1 else "data.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "report.html"
    data = json.load(open(data_path, encoding="utf-8"))
    items = data.get(NEWS_SOURCE_KEY) or []
    if not isinstance(items, list):
        print(f"오류: '{NEWS_SOURCE_KEY}' 는 배열이어야 합니다.", file=sys.stderr)
        sys.exit(1)

    html_out = tpl
    counts = {}
    for name, block in blocks(tpl).items():
        region = GROUPS.get(name)
        group = [i for i in items if isinstance(i, dict) and str(i.get("region", "")).strip() == region]
        counts[name] = len(group)
        html_out = REPEAT_RE.sub(
            lambda m, b=block, g=group: render_group(b, g) if m.group(1) == name else m.group(0),
            html_out,
        )

    auto = computed()
    for k in ks:
        if k.endswith("_COUNT"):
            val = counts.get(k[: -len("_COUNT")], 0)
        elif k in auto:
            val = auto[k]
        else:
            raw = str(data.get(k, "—"))
            cap = MAX_LEN.get(k)
            if cap and len(raw) > cap:
                print(f"경고 — {k} 가 {cap}자를 초과해 잘림({len(raw)}자)")
                raw = raw[: cap - 1] + "…"
            val = esc(raw)
        html_out = html_out.replace("{{" + k + "}}", str(val))

    open(out_path, "w", encoding="utf-8").write(html_out)

    grouped = sum(counts.values())
    # 종전 "토큰 N개" 는 **치환에 성공한** 토큰 수인데, 에이전트가 매번 "미해결 N개"로 읽었다
    # (2026-08-09: 정상 렌더된 리포트에 [GOAL_INCOMPLETE] 마커를 붙여 실패 기록·게시 누락).
    # 성공/실패를 문구로 단정해 오해의 여지를 없앤다 — 미치환 수를 실제로 세서 함께 보고한다.
    leftover = len(TOKEN_RE.findall(html_out))
    status = "정상" if leftover == 0 else f"미치환 {leftover}개 남음"
    print(f"렌더 완료({status}): {out_path} ({len(html_out)} bytes, "
          f"치환 {len(ks)}개·미치환 {leftover}개, 기사 {grouped}건 {counts})")
    missing = [k for k in ks if not k.endswith("_COUNT") and k not in auto and k not in data]
    if missing:
        print("경고 — data.json 미제공 키(—로 채움): " + ", ".join(missing))
    # 역방향 검사: 템플릿이 쓰지 않는 데이터는 조용히 버려진다(구 고정 슬롯 사고의 원인).
    unused = [k for k in data if k != NEWS_SOURCE_KEY and k not in ks]
    if unused:
        print("경고 — 템플릿이 사용하지 않아 버려진 키: " + ", ".join(unused))
    if grouped < len(items):
        print(f"경고 — region 이 '국내'/'국외' 가 아니어서 누락된 기사 {len(items) - grouped}건")


if __name__ == "__main__":
    main()
