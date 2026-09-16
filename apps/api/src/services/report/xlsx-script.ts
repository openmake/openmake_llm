/**
 * csv 아티팩트·보고서 reportdata → .xlsx 변환 python 스크립트 (컨테이너 내 python3 -c 로 실행, F20.1).
 *
 * docx-script 와 같은 계약: 데이터는 stdin(JSON — {"csv": string} 또는 {"data": reportdata}), 산출물은 stdout(base64 xlsx).
 * 스크립트는 정적이라 사용자 데이터가 코드에 섞이지 않는다. task-runtime 이미지 /opt/pyenv 의 openpyxl 3.1.x.
 *
 * - 수식 인젝션: = + - @ 탭 CR 로 시작하는 문자열 셀은 앞에 ' 를 붙인다(스프레드시트가 수식으로 평가하지 않게).
 * - 숫자: 정수·소수 문자열만 숫자로(앞자리 0·지수 표기·15자 초과는 문자열 유지 — 코드·우편번호·긴 ID 보존).
 * - 시트명: 금지 문자 치환·31자·중복은 " (2)".
 * - 행 상한: 시트당 maxRows(ARTIFACT_EXPORT.xlsxMaxRows) — 넘으면 자르고 마지막 행에 남은 수 표시.
 * 역슬래시가 든 정규식이 있어 String.raw 로 감싼다(일반 템플릿 문자열은 \d 의 역슬래시를 지운다).
 *
 * @module services/report/xlsx-script
 */
export const REPORT_XLSX_SCRIPT = String.raw`
import sys, json, base64, io, csv, re
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

payload = json.load(sys.stdin)
MAX_ROWS = int(payload.get('maxRows') or 100000) if isinstance(payload, dict) else 100000
NUM_RE = re.compile(r'^-?(0|[1-9]\d*)(\.\d+)?$')
FORMULA_START = ('=', '+', '-', '@', '\t', '\r')
BAD_SHEET = re.compile(r'[\[\]:*?/\\]')
MAX_COL_WIDTH = 60

def s(v):
    return '' if v is None else str(v)

def value(v):
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, (int, float)):
        return v
    t = s(v)
    st = t.strip()
    if NUM_RE.match(st) and len(st) <= 15:
        return int(st) if '.' not in st else float(st)
    if t.startswith(FORMULA_START):
        return "'" + t
    return t

wb = Workbook()
wb.remove(wb.active)
used = set()

def sheet(name):
    base = BAD_SHEET.sub('_', s(name)).strip() or 'Sheet'
    base = base[:31]
    title, i = base, 2
    while title.lower() in used:
        suffix = f' ({i})'
        title = base[:31 - len(suffix)] + suffix
        i += 1
    used.add(title.lower())
    return wb.create_sheet(title)

def write_table(ws, headers, rows):
    widths = {}
    r0 = 1
    if headers:
        ws.append([value(h) for h in headers])
        for c in ws[1]:
            c.font = Font(bold=True)
        for i, h in enumerate(headers, 1):
            widths[i] = len(s(h))
        r0 = 2
    for row in rows[:MAX_ROWS]:
        vals = row if isinstance(row, list) else [row]
        ws.append([value(x) for x in vals])
        for i, x in enumerate(vals, 1):
            widths[i] = max(widths.get(i, 0), len(s(x)))
    if len(rows) > MAX_ROWS:
        ws.append([f'... truncated: {len(rows) - MAX_ROWS} more rows'])
    for i, w in widths.items():
        ws.column_dimensions[get_column_letter(i)].width = min(MAX_COL_WIDTH, max(8, w + 2))

if isinstance(payload, dict) and isinstance(payload.get('csv'), str):
    rows = list(csv.reader(io.StringIO(payload['csv'])))
    write_table(sheet('Data'), rows[0] if rows else [], rows[1:])
else:
    data = payload.get('data', payload) if isinstance(payload, dict) else {}
    ws = sheet('Summary')
    for label, key in (('Title', 'REPORT_TITLE'), ('Subtitle', 'SUBTITLE'), ('Date', 'RUN_DATE'), ('Topline', 'TOPLINE'), ('Summary', 'SUMMARY')):
        if data.get(key):
            ws.append([label, value(data[key])])
            ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    ws.column_dimensions['A'].width = 14
    ws.column_dimensions['B'].width = MAX_COL_WIDTH
    kpis = [k for k in (data.get('kpis') or []) if isinstance(k, dict)]
    if kpis:
        write_table(sheet('KPIs'), ['Label', 'Value', 'Note', 'Delta'], [[k.get('label'), k.get('value'), k.get('note'), k.get('delta')] for k in kpis])
    for n, sec in enumerate(data.get('sections') or [], 1):
        if not isinstance(sec, dict):
            continue
        tb = sec.get('table')
        if isinstance(tb, dict) and (tb.get('headers') or tb.get('rows')):
            write_table(sheet(sec.get('heading') or f'Section {n}'), tb.get('headers') or [], tb.get('rows') or [])
    sources = [x for x in (data.get('sources') or []) if isinstance(x, dict)]
    if sources:
        write_table(sheet('Sources'), ['#', 'Title', 'URL'], [[i, x.get('title'), x.get('url')] for i, x in enumerate(sources, 1)])

buf = io.BytesIO()
wb.save(buf)
sys.stdout.write(base64.b64encode(buf.getvalue()).decode())
`;
