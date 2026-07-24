#!/usr/bin/env python3
"""
AI 트렌드 데일리 리포트 렌더러 — 고정 디자인 템플릿에 data.json 값만 치환.

디자인(HTML/CSS/구조)은 절대 바뀌지 않는다. LLM 은 데이터(data.json)만 생성하고,
이 스크립트가 {{TOKEN}} 을 결정적으로 치환해 report.html 을 만든다 → OD 템플릿 픽셀-정합.

사용:
  python3 render_report.py --keys              # 채워야 할 토큰(키) 목록 출력
  python3 render_report.py data.json report.html
"""
import sys, json, re, os

BASE = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(BASE, "ai-trend-daily.html")
TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")


def tokens():
    html = open(TPL, encoding="utf-8").read()
    # 등장 순서 유지(중복 제거) — LLM 이 data.json 을 만들 때 순서대로 채우기 쉽게.
    seen, out = set(), []
    for m in TOKEN_RE.finditer(html):
        if m.group(1) not in seen:
            seen.add(m.group(1)); out.append(m.group(1))
    return out


def main():
    if "--keys" in sys.argv:
        print("\n".join(tokens()))
        return
    data_path = sys.argv[1] if len(sys.argv) > 1 else "data.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "report.html"
    data = json.load(open(data_path, encoding="utf-8"))
    html = open(TPL, encoding="utf-8").read()
    ks = tokens()
    for k in ks:
        val = data.get(k, "—")
        html = html.replace("{{" + k + "}}", str(val))
    open(out_path, "w", encoding="utf-8").write(html)
    missing = [k for k in ks if k not in data]
    print(f"렌더 완료: {out_path} ({len(html)} bytes, 토큰 {len(ks)}개)")
    if missing:
        print("경고 — data.json 미제공 키(—로 채움): " + ", ".join(missing))


if __name__ == "__main__":
    main()
