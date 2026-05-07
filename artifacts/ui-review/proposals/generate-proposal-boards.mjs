import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve('artifacts/ui-review/proposals');
await fs.mkdir(outDir, { recursive: true });

const html = String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OpenMake UI/UX Redesign Proposal Boards</title>
<style>
@font-face{font-family:Pretendard;src:url('../../../frontend/web/public/vendor/pretendard/woff2/Pretendard-Regular.woff2') format('woff2');font-weight:400}
@font-face{font-family:Pretendard;src:url('../../../frontend/web/public/vendor/pretendard/woff2/Pretendard-Bold.woff2') format('woff2');font-weight:700}
@font-face{font-family:Pretendard;src:url('../../../frontend/web/public/vendor/pretendard/woff2/Pretendard-ExtraBold.woff2') format('woff2');font-weight:800}
:root{
    --ink:#07111f;--navy:#0b1324;--panel:#101c30;--panel2:#13243a;--line:#28415f;--muted:#8fa6bf;--text:#eef7ff;
    --cyan:#62e6ff;--mint:#7cf5bd;--amber:#ffd166;--rose:#ff7a90;--blue:#78a9ff;--paper:#f5f7fb;
}
*{box-sizing:border-box} body{margin:0;background:#0a1020;color:var(--text);font-family:Pretendard, ui-sans-serif, system-ui;}
.board{width:1920px;height:1080px;position:relative;overflow:hidden;padding:54px 64px;background:
    radial-gradient(circle at 8% 12%, rgba(98,230,255,.18), transparent 28%),
    radial-gradient(circle at 90% 10%, rgba(255,209,102,.16), transparent 25%),
    linear-gradient(135deg,#07111f 0%,#0b1324 44%,#111827 100%);}
.board:after{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.5),transparent 80%)}
.kicker{position:relative;z-index:1;display:inline-flex;gap:10px;align-items:center;border:1px solid rgba(98,230,255,.28);background:rgba(98,230,255,.08);color:var(--cyan);border-radius:999px;padding:10px 16px;font-size:18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
h1{position:relative;z-index:1;margin:18px 0 8px;font-size:58px;line-height:1.06;letter-spacing:-.04em;font-weight:800} .sub{position:relative;z-index:1;color:#b5c5d7;font-size:22px;line-height:1.55;max-width:1180px;margin:0 0 32px}.accent{color:var(--mint)}
.grid{position:relative;z-index:1;display:grid;gap:24px}.g2{grid-template-columns:1.05fr .95fr}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
.card{background:linear-gradient(180deg,rgba(20,36,58,.86),rgba(11,19,36,.92));border:1px solid rgba(144,180,220,.22);border-radius:28px;box-shadow:0 24px 70px rgba(0,0,0,.34);padding:26px;position:relative;overflow:hidden}.card.light{background:#f7f9fc;color:#111827;border:0}.card h2{margin:0 0 14px;font-size:28px;letter-spacing:-.03em}.card h3{margin:0 0 8px;font-size:22px}.card p{margin:0;color:#b7c6d6;font-size:17px;line-height:1.48}.light p{color:#536276}.tag{display:inline-flex;border-radius:999px;padding:7px 11px;background:rgba(124,245,189,.12);color:var(--mint);font-size:13px;font-weight:700}.tag.amber{background:rgba(255,209,102,.14);color:var(--amber)}.tag.rose{background:rgba(255,122,144,.14);color:var(--rose)}.tag.blue{background:rgba(120,169,255,.16);color:var(--blue)}
.mock{background:#eef3f8;color:#0d1724;border-radius:32px;padding:18px;box-shadow:0 22px 70px rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.5);height:650px}.app{height:100%;border-radius:24px;background:linear-gradient(135deg,#f9fbff,#eaf1f8);overflow:hidden;display:grid;grid-template-columns:240px 1fr}.side{background:#0c1727;color:#d8e7f7;padding:22px;display:flex;flex-direction:column;gap:16px}.brand{display:flex;gap:10px;align-items:center;font-weight:800;font-size:19px}.orb{width:34px;height:34px;border-radius:13px;background:conic-gradient(from 180deg,var(--cyan),var(--mint),var(--amber),var(--cyan));box-shadow:0 0 30px rgba(98,230,255,.42)}.nav{display:flex;gap:10px;align-items:center;border-radius:14px;padding:12px 14px;color:#9bb0c5;font-size:15px}.nav.active{background:linear-gradient(90deg,rgba(98,230,255,.2),rgba(124,245,189,.12));color:#fff}.main{padding:28px;background:linear-gradient(140deg,#f7fafe,#edf4fa)}.topline{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}.pill{border-radius:999px;background:#e1ebf4;color:#31506f;padding:8px 13px;font-size:13px;font-weight:700}.btn{border:0;border-radius:15px;padding:12px 18px;background:#0b1324;color:#fff;font-weight:800}.btn.cyan{background:#11b7d6}.btn.mint{background:#15b981}.hero{background:linear-gradient(135deg,#0b1728,#12314a);color:white;border-radius:28px;padding:26px;margin-bottom:18px;position:relative;overflow:hidden}.hero:after{content:"";position:absolute;right:-50px;top:-60px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,var(--cyan),transparent 62%);opacity:.26}.hero h2{font-size:36px;margin:0 0 10px;letter-spacing:-.04em}.hero p{color:#b9c9d8}.inputbar{height:118px;background:white;border:1px solid #dce7f0;border-radius:26px;margin-top:16px;padding:18px;display:flex;justify-content:space-between;align-items:flex-end}.smallgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.tile{background:white;border:1px solid #dce7f0;border-radius:20px;padding:18px;min-height:116px}.tile b{font-size:18px}.tile span{display:block;margin-top:8px;color:#65758a;font-size:14px}.kpirow{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.kpi{background:white;border:1px solid #dae5ef;border-radius:20px;padding:18px}.kpi b{display:block;font-size:28px;letter-spacing:-.03em}.kpi span{font-size:13px;color:#66778a}.chart{height:168px;border-radius:20px;background:linear-gradient(180deg,#ffffff,#eef5fb);border:1px solid #dae5ef;padding:18px;display:flex;align-items:end;gap:12px}.bar{flex:1;border-radius:8px 8px 0 0;background:linear-gradient(180deg,#11b7d6,#15b981)}
.note-list{display:grid;gap:14px}.note{display:grid;grid-template-columns:120px 1fr;gap:16px;padding:17px;border-radius:18px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1)}.note b{color:#fff;font-size:17px}.note span{color:#b8c7d8;font-size:16px;line-height:1.42}.priority{position:absolute;right:24px;top:22px}
.matrix{position:relative;z-index:1;background:#f7f9fc;color:#152032;border-radius:30px;padding:30px;box-shadow:0 28px 90px rgba(0,0,0,.36)}table{width:100%;border-collapse:collapse;font-size:17px}th{text-align:left;color:#536276;font-size:13px;text-transform:uppercase;letter-spacing:.08em;padding:12px 14px;border-bottom:2px solid #dbe4ef}td{padding:13px 14px;border-bottom:1px solid #e0e7f0;vertical-align:top}td:first-child{font-weight:800;color:#0b1324}.level{font-size:12px;border-radius:999px;padding:5px 9px;font-weight:800;white-space:nowrap}.p1{background:#ffe7ec;color:#c42147}.p2{background:#fff4cc;color:#8d6500}.p3{background:#dff8ec;color:#0f7a4a}.footer{position:absolute;left:64px;right:64px;bottom:32px;z-index:1;display:flex;justify-content:space-between;color:#7f95ad;font-size:15px}.device{height:650px;border-radius:38px;background:#0a111d;padding:14px;box-shadow:0 30px 80px rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.1)}.screen{height:100%;border-radius:28px;background:#f5f8fb;color:#111827;overflow:hidden}.screen .head{background:#0c1727;color:white;padding:20px 22px}.screen .body{padding:22px}.flow{display:flex;align-items:center;gap:10px;margin:14px 0}.dot{width:16px;height:16px;border-radius:50%;background:var(--mint)}.line{height:3px;flex:1;background:#d8e3ee;border-radius:99px}.listitem{background:white;border:1px solid #dde7f1;border-radius:18px;padding:16px;margin:12px 0}#board-02 .device{height:560px}#board-02 .grid.g3{gap:20px}#board-02 .grid.g4{margin-top:18px}#board-02 .grid.g4 .card{padding:18px;border-radius:22px}#board-02 .grid.g4 .card h3{font-size:20px;margin-bottom:6px}#board-02 .grid.g4 .card p{font-size:14px;line-height:1.34}#board-02 .footer{bottom:20px}.mini{font-size:13px;color:#65758a}.rail{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.chip{border:1px solid #d5e0eb;background:#fff;border-radius:999px;padding:8px 11px;color:#405772;font-size:13px;font-weight:700}
</style>
</head>
<body>
<section class="board" id="board-01">
    <div class="kicker">Board 01 · Core Experience</div>
    <h1>채팅 중심 화면을 <span class="accent">작업 콘솔</span>로 고도화</h1>
    <p class="sub">현재 채팅/로그인/문서/가이드/API 문서는 같은 보라색 표면과 반복 헤더에 의존합니다. 제안안은 입력창, 모델 상태, 비용 예측, 문서 컨텍스트를 한 화면에서 판단하게 만드는 구조입니다.</p>
    <div class="grid g2">
        <div class="mock">
            <div class="app">
                <aside class="side">
                    <div class="brand"><div class="orb"></div>OpenMake</div>
                    <div class="nav active">⌘ 채팅 콘솔</div><div class="nav">문서 허브</div><div class="nav">리서치</div><div class="nav">API 문서</div><div class="nav">운영 모니터</div>
                    <div style="margin-top:auto"><div class="pill" style="background:#19324d;color:#9ee8ff">Enterprise · Online</div></div>
                </aside>
                <main class="main">
                    <div class="topline"><div><div class="pill">Gemma 4 E4B · Local</div></div><button class="btn cyan">새 작업</button></div>
                    <div class="hero"><h2>오늘의 작업을 바로 시작하세요</h2><p>모드 추천, 문서 컨텍스트, 예상 토큰/비용을 입력 전부터 표시합니다.</p><div class="inputbar"><span style="color:#7c8da2">질문, 파일, URL을 한 번에 입력...</span><button class="btn mint">실행</button></div></div>
                    <div class="smallgrid"><div class="tile"><b>코드 리뷰</b><span>위험도와 테스트 누락 자동 점검</span></div><div class="tile"><b>문서 요약</b><span>PDF/Markdown에서 근거 표시</span></div><div class="tile"><b>리서치</b><span>단계·출처·보고서 생성</span></div></div>
                </main>
            </div>
        </div>
        <div class="card">
            <span class="tag amber priority">핵심 개선</span><h2>페이지별 제안</h2>
            <div class="note-list">
                <div class="note"><b>채팅</b><span>웰컴 카드보다 작업 시작성이 중요합니다. 모델 상태, 프롬프트 모드, 첨부 문서, 예상 비용을 composer 주변에 통합합니다.</span></div>
                <div class="note"><b>로그인</b><span>단일 카드 중앙 배치를 유지하되, 우측에 보안/게스트/데이터 저장 정책을 보여 주는 신뢰 패널을 추가합니다.</span></div>
                <div class="note"><b>문서 관리</b><span>빈 화면을 업로드 CTA만 두지 말고 최근 문서, 처리 상태, 질문 시작 버튼, 지원 포맷을 카드화합니다.</span></div>
                <div class="note"><b>사용 가이드</b><span>긴 본문은 sticky 목차, 검색, “3분 빠른 시작” 탭으로 재구성합니다. 현재는 읽기 피로도가 큽니다.</span></div>
                <div class="note"><b>API 문서</b><span>좌측 TOC와 채팅 사이드바가 겹쳐 정보가 좁습니다. API 문서는 독립 docs layout, copy/test CTA, language tabs 고정이 필요합니다.</span></div>
            </div>
        </div>
    </div>
    <div class="footer"><span>Observed URL: rasplay.tplinkdns.com:52416</span><span>Output: Core UX proposal PNG</span></div>
</section>
<section class="board" id="board-02">
    <div class="kicker">Board 02 · Productivity Pages</div>
    <h1>Pro 기능은 <span class="accent">빈 상태 + 진행 상태</span>를 제품화해야 합니다</h1>
    <p class="sub">리서치, 커스텀 에이전트, 스킬, 메모리, API 키는 기능 자체보다 상태와 다음 행동이 약합니다. 샘플 데이터 기반 캡처에서도 많은 화면이 넓은 빈 공간 또는 단순 카드 나열로 보입니다.</p>
    <div class="grid g3">
        <div class="device"><div class="screen"><div class="head"><b>딥 리서치 파이프라인</b><div class="mini" style="color:#a9bfd6">진행 62% · 4개 출처 검증 중</div></div><div class="body"><div class="flow"><div class="dot"></div><div class="line"></div><div class="dot"></div><div class="line"></div><div class="dot" style="background:#d5dee8"></div></div><div class="listitem"><b>01 주제 분해</b><div class="mini">검색 쿼리 6개 생성</div></div><div class="listitem"><b>02 출처 수집</b><div class="mini">신뢰도, 날짜, 중복 표시</div></div><button class="btn cyan" style="width:100%">보고서 미리보기</button></div></div></div>
        <div class="device"><div class="screen"><div class="head"><b>에이전트 빌더</b><div class="mini" style="color:#a9bfd6">템플릿에서 2분 생성</div></div><div class="body"><div class="rail"><span class="chip">코드 리뷰어</span><span class="chip">문서 작성</span><span class="chip">데이터 분석</span></div><div class="listitem"><b>역할</b><div class="mini">목표, 금지사항, 검증 루프</div></div><div class="listitem"><b>연결 스킬</b><div class="mini">웹 검색 · 파일 · 코드 실행</div></div><button class="btn mint" style="width:100%">에이전트 생성</button></div></div></div>
        <div class="device"><div class="screen"><div class="head"><b>메모리 & API 키</b><div class="mini" style="color:#a9bfd6">보안과 개인화 통합</div></div><div class="body"><div class="listitem"><b>프로젝트 기억</b><div class="mini">신뢰도 92% · 최근 사용 2시간 전</div></div><div class="listitem"><b>Production API</b><div class="mini">Scope: chat, documents · 마지막 사용 오늘</div></div><div class="rail"><span class="chip">회전</span><span class="chip">권한 축소</span><span class="chip">감사 로그</span></div></div></div></div>
    </div>
    <div class="grid g4" style="margin-top:24px">
        <div class="card"><span class="tag">Research</span><h3>딥 리서치</h3><p>입력 폼 + 세션 카드에서 끝나지 말고 단계 타임라인, 출처 품질, 중간 산출물 미리보기를 보여줍니다.</p></div>
        <div class="card"><span class="tag blue">Agents</span><h3>커스텀 에이전트</h3><p>빈 상태에 템플릿 갤러리, 권장 스킬 조합, 테스트 프롬프트를 배치합니다.</p></div>
        <div class="card"><span class="tag amber">Skills</span><h3>스킬 라이브러리</h3><p>카테고리 필터, 설치 상태, 위험 권한, 버전 정보를 한 카드 안에서 비교 가능하게 만듭니다.</p></div>
        <div class="card"><span class="tag rose">Security</span><h3>메모리/API 키</h3><p>개인정보·권한·만료일을 표면화합니다. 사용자가 “무엇이 저장/노출되는지” 즉시 알 수 있어야 합니다.</p></div>
    </div>
    <div class="footer"><span>Pages: research, custom-agents, skill-library, memory, api-keys</span><span>Proposal: productivity workflows</span></div>
</section>
<section class="board" id="board-03">
    <div class="kicker">Board 03 · Admin & Monitoring</div>
    <h1>운영 화면은 <span class="accent">카드 더미</span>가 아니라 의사결정 대시보드여야 합니다</h1>
    <p class="sub">사용량, 관리자, 모니터링, 클러스터, 감사, 알림 화면은 숫자는 많지만 위험도와 조치 우선순위가 약합니다. 현재 일부 KPI가 세로로 길게 쌓이고, 차트/테이블/알림 간 관계가 분리되어 보입니다.</p>
    <div class="grid g2">
        <div class="mock">
            <div class="app" style="grid-template-columns:220px 1fr">
                <aside class="side"><div class="brand"><div class="orb"></div>Ops</div><div class="nav active">통합 모니터</div><div class="nav">사용량</div><div class="nav">클러스터</div><div class="nav">감사 로그</div><div class="nav">알림</div></aside>
                <main class="main">
                    <div class="topline"><div><div class="pill">위험도: Warning</div></div><button class="btn">Incident View</button></div>
                    <div class="kpirow"><div class="kpi"><span>오늘 요청</span><b>1,240</b></div><div class="kpi"><span>비용</span><b>$18.74</b></div><div class="kpi"><span>오류율</span><b>1.2%</b></div><div class="kpi"><span>활성 노드</span><b>1/2</b></div></div>
                    <div class="chart"><div class="bar" style="height:44%"></div><div class="bar" style="height:62%"></div><div class="bar" style="height:55%"></div><div class="bar" style="height:78%"></div><div class="bar" style="height:70%"></div><div class="bar" style="height:92%;background:linear-gradient(180deg,#ffd166,#ff7a90)"></div><div class="bar" style="height:66%"></div></div>
                    <div class="smallgrid" style="margin-top:16px"><div class="tile"><b>API 키 #2 실패</b><span>2회 실패 · 자동 로테이션 권장</span></div><div class="tile"><b>remote-cpu-1 지연</b><span>180ms · 큐 대기 증가</span></div><div class="tile"><b>알림 정책</b><span>토큰 80% 초과시 Slack 전송</span></div></div>
                </main>
            </div>
        </div>
        <div class="card">
            <span class="tag rose priority">P1</span><h2>운영 페이지별 제안</h2>
            <div class="note-list">
                <div class="note"><b>API 사용량</b><span>KPI가 '-'로 보이는 상태를 없애고, 기간 비교·비용 예측·오류 원인을 요약하는 insight strip을 추가합니다.</span></div>
                <div class="note"><b>통합 모니터링</b><span>51개 카드 수준의 복잡도를 위험도, 비용, 처리량, 노드 상태 4개 영역으로 재배치합니다.</span></div>
                <div class="note"><b>클러스터</b><span>노드 리스트 대신 라우팅 상태, 지연, 큐, 모델 가용성을 한 노드 카드 안에 표시합니다.</span></div>
                <div class="note"><b>사용자 관리</b><span>권한/활성/최근 로그인/사용량을 테이블 컬럼으로 정리하고 bulk action을 상단에 둡니다.</span></div>
                <div class="note"><b>감사·알림</b><span>필터 칩, 심각도 색상, 세부 로그 drawer, 알림 테스트 버튼으로 운영 대응 시간을 줄입니다.</span></div>
            </div>
        </div>
    </div>
    <div class="footer"><span>Pages: usage, admin, admin-metrics, cluster, audit, analytics, alerts</span><span>Proposal: operations dashboard</span></div>
</section>
<section class="board" id="board-04">
    <div class="kicker">Board 04 · Page-by-page Matrix</div>
    <h1>페이지별 UI/UX 고도화 우선순위</h1>
    <p class="sub">실제 URL 캡처와 임시 인증 샘플 캡처 기준입니다. 로그인 필요 페이지는 운영 계정 없이 UI 구조만 평가했습니다. external, uir-monitor, token-monitoring은 접근/라우팅 일관성 이슈가 관찰됐습니다.</p>
    <div class="matrix">
        <table>
            <thead><tr><th>Page</th><th>현재 관찰</th><th>디자인 제안</th><th>Priority</th></tr></thead>
            <tbody>
                <tr><td>채팅</td><td>웰컴 중심, 카드 일부가 composer와 충돌</td><td>작업 콘솔형 composer, 모델/비용/문서 컨텍스트 통합</td><td><span class="level p1">P1</span></td></tr>
                <tr><td>로그인</td><td>단일 폼 중심, 신뢰 정보 부족</td><td>보안/게스트/데이터 정책 패널과 명확한 OAuth 구분</td><td><span class="level p2">P2</span></td></tr>
                <tr><td>사용 가이드</td><td>긴 문서형 본문, 탐색 피로</td><td>sticky 목차, 검색, 빠른 시작/모드별 탭</td><td><span class="level p2">P2</span></td></tr>
                <tr><td>API 문서</td><td>문서 TOC와 앱 사이드바가 동시에 공간 차지</td><td>독립 docs layout, copy/test CTA, SDK 탭 고정</td><td><span class="level p1">P1</span></td></tr>
                <tr><td>문서 관리</td><td>넓은 빈 공간, 업로드 후 행동 약함</td><td>문서 파이프라인, 처리 상태, 질문 시작 CTA</td><td><span class="level p1">P1</span></td></tr>
                <tr><td>딥 리서치</td><td>폼 + 세션 카드 중심</td><td>단계 타임라인, 출처 품질, 보고서 미리보기</td><td><span class="level p1">P1</span></td></tr>
                <tr><td>커스텀 에이전트</td><td>빈 상태가 단순</td><td>템플릿 갤러리, 스킬 추천, 테스트 프롬프트</td><td><span class="level p2">P2</span></td></tr>
                <tr><td>스킬 라이브러리</td><td>카드 나열 중심</td><td>카테고리/권한/버전/설치 상태 비교 카드</td><td><span class="level p2">P2</span></td></tr>
                <tr><td>AI 메모리</td><td>저장 정보의 신뢰도와 노출 범위가 약함</td><td>신뢰도, 출처, 만료, 개인정보 토글</td><td><span class="level p2">P2</span></td></tr>
                <tr><td>API 사용량</td><td>KPI/차트 연결 약함</td><td>비용 예측, 오류 원인, 기간 비교 insight strip</td><td><span class="level p1">P1</span></td></tr>
                <tr><td>API 키 관리</td><td>보안 행동이 숨겨짐</td><td>scope, last used, rotate/revoke, 위험 배지</td><td><span class="level p1">P1</span></td></tr>
                <tr><td>관리자/모니터링</td><td>카드 과밀 또는 세로 스택</td><td>위험도 기반 통합 ops dashboard</td><td><span class="level p1">P1</span></td></tr>
                <tr><td>감사/알림/분석</td><td>필터와 조치 흐름이 분리</td><td>심각도 필터, drawer detail, 알림 테스트 CTA</td><td><span class="level p2">P2</span></td></tr>
                <tr><td>외부 연동/라우터</td><td>external 오류, uir/token redirect 관찰</td><td>라우트 등록/권한/빈 상태를 명확히 분리</td><td><span class="level p1">P1</span></td></tr>
            </tbody>
        </table>
    </div>
    <div class="footer"><span>Scope: all observed navigation pages</span><span>Deliverable: page-by-page recommendation matrix</span></div>
</section>
</body>
</html>`;

const htmlPath = path.join(outDir, 'openmake-uiux-proposals.html');
await fs.writeFile(htmlPath, html);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto('file://' + htmlPath, { waitUntil: 'load' });
await page.waitForTimeout(500);
const boards = ['board-01','board-02','board-03','board-04'];
for (const id of boards) {
    const el = page.locator('#' + id);
    await el.screenshot({ path: path.join(outDir, `${id}-openmake-uiux-proposal.png`) });
}
await browser.close();
console.log(boards.map(id => path.join(outDir, `${id}-openmake-uiux-proposal.png`)).join('\n'));
