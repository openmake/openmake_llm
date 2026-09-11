/* 멀티모달 오케스트레이터 라이브 검증 하네스 — REST /api/chat(127.0.0.1 직결, user 3). 검증 후 세션 삭제는 별도. */
require('/Volumes/MAC_APP/openmake_llm/node_modules/dotenv').config({ quiet: true });
const jwt = require('/Volumes/MAC_APP/openmake_llm/node_modules/jsonwebtoken');
const fs = require('fs');
const B = 'http://127.0.0.1:52416';
const token = jwt.sign({ userId: '3', email: 'excellokrea2@gmail.com', role: 'admin', type: 'access' }, process.env.JWT_SECRET, { expiresIn: '2h', jwtid: 'orch-' + Date.now() });
let csrf = null;
async function api(method, path, body, timeoutMs = 900000) {
  const headers = { Cookie: `auth_token=${token}${csrf ? `; csrf_token=${csrf}` : ''}`, 'Content-Type': 'application/json' };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const r = await fetch(`${B}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j };
}
async function chat(message, extra = {}) {
  const t0 = Date.now();
  const r = await api('POST', '/api/chat', { message: `라이브검증::orch ${message}`, model: extra.model || 'local-llm:qwen3.8-27b', stream: false, saveHistory: false, ...extra });
  const s = Math.round((Date.now() - t0) / 1000);
  const resp = r.j?.data?.response ?? JSON.stringify(r.j).slice(0, 300);
  console.log(`\n[${s}s] ${r.status} ${message}\n→ ${String(resp).slice(0, 500).replace(/\n/g, ' ⏎ ')}\n   session=${r.j?.data?.sessionId}`);
  return r;
}
(async () => {
  const c = await api('GET', '/api/csrf-token'); csrf = c.j?.data?.csrfToken ?? c.j?.csrfToken; console.log('csrf', c.status, !!csrf);
  const mode = process.argv[2];
  if (mode === 'setup') {
    for (const [cap, model] of [['audio.speech', 'hasa:melotts-ko'], ['audio.transcribe', 'hasa:whisper-large-v3-turbo'], ['image.edit', 'hasa:Qwen-Image-Edit'], ['video.generate', 'hasa:Wan2.2-T2V'], ['vision.describe', 'bai:qwen3.8-flash']]) {
      const r = await api('PUT', `/api/users/me/capability-models/${cap}`, { model }); console.log('PUT', cap, r.status, JSON.stringify(r.j).slice(0, 120));
    }
    const pr = await api('PUT', '/api/users/me/model-roles/planner', { model: process.argv[3] || 'bai:qwen3.8-flash' }); console.log('PUT planner', pr.status, JSON.stringify(pr.j).slice(0, 160));
    const g = await api('GET', '/api/users/me/capability-models'); console.log('effective', JSON.stringify(g.j?.data?.effective));
  } else if (mode === 'simple') {
    await chat('한국의 수도는 어디야? 한 문장으로.');
  } else if (mode === 'image') {
    await chat('흰 배경에 작은 빨간 원 하나를 그려줘. 512x512.');
  } else if (mode === 'edit') {
    const prev = process.argv[3];
    await chat(`방금 만든 이미지의 원을 파란색으로 바꿔줘.`, { history: [{ role: 'user', content: '빨간 원 그려줘' }, { role: 'assistant', content: `![red](${prev})` }] });
  } else if (mode === 'tts') {
    await chat('"안녕하세요, 오케스트레이터 테스트입니다." 이 문장을 음성으로 읽어줘.');
  } else if (mode === 'parallel') {
    await chat('두 가지를 동시에 해줘: 1) 노란 별 하나를 그려주고 2) "별이 빛난다" 를 음성으로 읽어줘.');
  } else if (mode === 'vision') {
    const png = fs.readFileSync('/Users/openmake_mac/.claude/jobs/51148d61/tmp/small.png').toString('base64');
    await chat('이 이미지에 무엇이 보여? 한 문장.', { model: 'hasa:qwen3-coder', images: [`data:image/png;base64,${png}`] });
  } else if (mode === 'stt') {
    const wav = fs.readFileSync(process.argv[3]);
    await chat('첨부한 음성 파일을 받아써줘.', { mediaFiles: [{ id: 'f1', name: 'a.wav', type: 'audio/wav', data: wav.toString('base64') }] });
  } else if (mode === 'music') {
    await chat('잔잔한 피아노 배경음악을 30초짜리로 만들어줘.');
  } else if (mode === 'video') {
    await chat('흰 배경에서 빨간 원이 천천히 도는 4초짜리 영상을 만들어줘.', {}, );
  }
})().catch((e) => { console.error(e); process.exit(1); });
