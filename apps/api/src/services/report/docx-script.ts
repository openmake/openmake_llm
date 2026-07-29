/**
 * reportdata → .docx 변환 python 스크립트 (컨테이너 내 python3 -c 로 실행).
 *
 * 데이터는 stdin(JSON), 산출물은 stdout(base64 docx) — 스크립트 자체는 정적이라
 * 사용자 데이터가 코드에 섞이지 않는다(인젝션 표면 없음). task-runtime 이미지의
 * /opt/pyenv(python-docx)에서 실행. generic-report 데이터 계약(config/report-templates)의
 * 구조(kpis/sections/sources)를 워드 문서로 직역한다 — html→docx 변환보다 고품질.
 *
 * @module services/report/docx-script
 */
export const REPORT_DOCX_SCRIPT = `
import sys, json, base64, io
from docx import Document

payload = json.load(sys.stdin)
data = payload.get('data', payload) if isinstance(payload, dict) else {}

def s(v):
    return '' if v is None else str(v)

doc = Document()
doc.add_heading(s(data.get('REPORT_TITLE') or 'Report'), 0)
if data.get('SUBTITLE'):
    doc.add_paragraph(s(data['SUBTITLE']))
meta = ' - '.join(s(data[k]) for k in ('KICKER', 'RUN_DATE', 'TOPLINE') if data.get(k))
if meta:
    doc.add_paragraph(meta)

if data.get('SUMMARY'):
    doc.add_heading('Executive Summary', level=1)
    doc.add_paragraph(s(data['SUMMARY']))

def add_table(headers, rows):
    if not headers:
        return
    t = doc.add_table(rows=1, cols=len(headers))
    try:
        t.style = 'Light Grid Accent 1'
    except Exception:
        pass
    for i, h in enumerate(headers):
        t.rows[0].cells[i].text = s(h)
    for r in rows:
        cells = t.add_row().cells
        vals = r if isinstance(r, list) else [r]
        for i, c in enumerate(vals):
            if i < len(cells):
                cells[i].text = s(c)

kpis = data.get('kpis') or []
if isinstance(kpis, list) and kpis:
    add_table(['Label', 'Value', 'Note', 'Delta'],
              [[k.get('label'), k.get('value'), k.get('note'), k.get('delta')]
               for k in kpis if isinstance(k, dict)])

for sec in (data.get('sections') or []):
    if not isinstance(sec, dict):
        continue
    doc.add_heading(s(sec.get('heading') or ''), level=1)
    for p in (sec.get('paragraphs') or []):
        doc.add_paragraph(s(p))
    for b in (sec.get('bullets') or []):
        doc.add_paragraph(s(b), style='List Bullet')
    tb = sec.get('table')
    if isinstance(tb, dict):
        add_table(tb.get('headers') or [], tb.get('rows') or [])
    ch = sec.get('chart')
    if isinstance(ch, dict) and (ch.get('labels') or []):
        labels = ch.get('labels') or []
        values = ch.get('values') or []
        unit = s(ch.get('unit'))
        line = ', '.join(f"{s(l)}={s(v)}{unit}" for l, v in zip(labels, values))
        doc.add_paragraph((s(ch.get('title')) + ': ' if ch.get('title') else '') + line)

sources = data.get('sources') or []
if isinstance(sources, list) and sources:
    doc.add_heading('Sources', level=1)
    for i, src in enumerate(sources, 1):
        if isinstance(src, dict):
            doc.add_paragraph(f"{i}. {s(src.get('title'))} - {s(src.get('url'))}")

buf = io.BytesIO()
doc.save(buf)
sys.stdout.write(base64.b64encode(buf.getvalue()).decode())
`;
