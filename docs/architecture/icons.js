// 도면 공용 아이콘 — arch.html · arch2.html 이 함께 쓴다.
//
// 브랜드 로고를 그대로 쓰지 않고 알아볼 수 있는 최소 도형으로 그린다. 전부 인라인
// SVG 라서 확대해도 뭉개지지 않고, 이미지 생성물처럼 글자가 깨질 일이 없다.
// (2026-08-23 참고 시안은 생성 이미지라 한국어가 여러 군데 깨져 있었다.)
window.I = {
  people: (c = '#1d4ed8', s = 42) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${c}"><circle cx="9" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.5"/><path d="M2.5 19c0-3.4 2.9-5.5 6.5-5.5s6.5 2.1 6.5 5.5z"/><path d="M16.5 13c3 0 5 1.7 5 4.4V19h-4.2c0-2-.6-3.6-1.6-4.8z"/></svg>`,
  globe: () => `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>`,
  menubar: () => `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.7"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M2.5 8h19M8 20h8"/><circle cx="5.6" cy="6" r=".8" fill="#334155"/></svg>`,
  terminal: () => `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="1.7"><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M6.5 9.5l3 2.5-3 2.5M12.5 15h5"/></svg>`,
  phone: () => `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="1.7"><rect x="6" y="2.5" width="12" height="19" rx="2.6"/><path d="M10.5 5h3"/><circle cx="12" cy="17.8" r="1"/></svg>`,
  discord: () => `<svg width="30" height="30" viewBox="0 0 24 24" fill="#5865f2"><path d="M19 5.5A15 15 0 0 0 15.4 4l-.3.6a12 12 0 0 1 3 1.2 13 13 0 0 0-12.2 0 12 12 0 0 1 3-1.2L8.6 4A15 15 0 0 0 5 5.5C2.6 9.2 2 12.8 2.3 16.3A15 15 0 0 0 7 18.7l.9-1.4a10 10 0 0 1-1.6-.8l.4-.3a10.6 10.6 0 0 0 10.6 0l.4.3a10 10 0 0 1-1.6.8l.9 1.4a15 15 0 0 0 4.7-2.4c.4-4-.6-7.6-2.7-10.8zM9.3 14.2c-.9 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.7.9 1.7 1.9-.8 1.9-1.7 1.9zm5.4 0c-.9 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.7.9 1.7 1.9-.8 1.9-1.7 1.9z"/></svg>`,
  cloudflare: (s = 34) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="#f6821f"><path d="M17.4 17H6.6a3.6 3.6 0 0 1-.5-7.2 5.2 5.2 0 0 1 9.9-1.4 3 3 0 0 1 1.4 8.6z"/></svg>`,
  house: () => `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="1.8"><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5V14h4v5.5"/></svg>`,
  shield: (c = '#f59e0b', s = 34) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8"><path d="M12 2.8 20 6v6c0 4.6-3.3 8-8 9.3C7.3 20 4 16.6 4 12V6z"/><path d="m8.8 12.2 2.2 2.2 4.2-4.4"/></svg>`,
  gear: (c = '#2563eb', s = 34) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v2.6M12 18.8v2.6M21.4 12h-2.6M5.2 12H2.6M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9M18.6 18.6l-1.9-1.9M7.3 7.3 5.4 5.4"/></svg>`,
  whale: () => `<svg width="34" height="34" viewBox="0 0 24 24" fill="#0891b2"><path d="M21.5 11.4c-.6-.4-1.7-.5-2.5-.3-.1-.9-.6-1.7-1.4-2.2l-.5-.3-.3.5c-.4.7-.5 1.7-.1 2.4H2.6c-.3 0-.5.2-.5.5 0 1.8.4 3.6 1.4 4.9 1.1 1.4 2.8 2.1 4.9 2.1 4.7 0 8.2-2.2 9.8-6.1.7 0 2.2 0 3-1.4l.2-.4zM5.4 9.4h2.2v2.2H5.4zm2.9 0h2.2v2.2H8.3zm2.9 0h2.2v2.2h-2.2zm-2.9-2.8h2.2v2.2H8.3zm2.9 0h2.2v2.2h-2.2zm0-2.9h2.2v2.2h-2.2z"/></svg>`,
  db: (c = '#0891b2', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg>`,
  layers: (c = '#e11d48', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><path d="m12 3 8.5 4.5L12 12 3.5 7.5z"/><path d="m3.5 12 8.5 4.5L20.5 12M3.5 16.5 12 21l8.5-4.5"/></svg>`,
  box: (c = '#e11d48', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><path d="M3.5 7.6 12 3l8.5 4.6v8.8L12 21l-8.5-4.6z"/><path d="M3.5 7.6 12 12.2l8.5-4.6M12 12.2V21"/></svg>`,
  netshield: (c = '#e11d48', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><path d="M12 2.8 19.5 6v6c0 4.4-3.1 7.6-7.5 8.9C7.6 19.6 4.5 16.4 4.5 12V6z"/><path d="M4.8 12h14.4M12 3.2c1.9 2.5 2.9 5.6 2.9 8.8s-1 6.3-2.9 8.8c-1.9-2.5-2.9-5.6-2.9-8.8s1-6.3 2.9-8.8z"/></svg>`,
  cube: (c = '#7c3aed', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8.5 9.5 11 12l-2.5 2.5M13 15h3"/></svg>`,
  bubble: (c = '#4ade80', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><path d="M20.5 12c0 4-3.8 7.2-8.5 7.2-1 0-2-.2-2.9-.4L4 20.5l1.4-3.6A6.9 6.9 0 0 1 3.5 12c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2z"/></svg>`,
  image: (c = '#4ade80', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><rect x="3.2" y="4.5" width="17.6" height="15" rx="2.5"/><circle cx="8.6" cy="9.6" r="1.6"/><path d="m4.5 17.5 5-5 4 4 2.5-2.5 3.5 3.5"/></svg>`,
  lock: (c = '#94a3b8', s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><rect x="4.5" y="10.5" width="15" height="10" rx="2.4"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/></svg>`,
  cloud2: (c = '#64748b', s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><path d="M17.5 18.5H7a4.2 4.2 0 0 1-.6-8.4 5.9 5.9 0 0 1 11.3-1.6 3.6 3.6 0 0 1-.2 10z"/></svg>`,
  nginx: () => `<svg width="26" height="26" viewBox="0 0 24 24" fill="#009639"><path d="M12 2 3 7v10l9 5 9-5V7zm4 13.2h-1.9l-4.3-6v6H8V8.8h1.9l4.3 6v-6H16z"/></svg>`,
  caddy: () => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="1.9"><path d="M16.8 7.6a6.5 6.5 0 1 0 0 8.8"/></svg>`,
  next: () => `<svg width="26" height="26" viewBox="0 0 24 24" fill="#0f172a"><circle cx="12" cy="12" r="9.5"/><path d="M9.2 8.2h1.5l5.4 7.3v-7.3h1.2v8.2h-1.4L9.2 8.8v7.6H8V8.2z" fill="#fff"/></svg>`,
  node: () => `<svg width="26" height="26" viewBox="0 0 24 24" fill="#5fa04e"><path d="m12 2.2 8.6 5v9.6l-8.6 5-8.6-5V7.2z"/><path d="M12 7.4c-2.4 0-3.9 1-3.9 2.7 0 1.8 1.4 2.3 3.6 2.6 2.7.3 2.9.7 2.9 1.2 0 .9-.7 1.3-2.4 1.3-2.1 0-2.6-.5-2.7-1.6h-1.5c.1 2 1.3 2.9 4.2 2.9 2.6 0 4-1 4-2.8 0-1.8-1.2-2.3-3.7-2.6-2.6-.3-2.8-.5-2.8-1.1 0-.5.2-1.2 2.2-1.2 1.8 0 2.4.4 2.6 1.5h1.5c-.2-1.9-1.4-2.9-4-2.9z" fill="#fff"/></svg>`,
  gateway: (c = '#0d9488', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>`,
  nvidia: (s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="#76b900"><path d="M3 9.5c3-3.4 7-4.6 10.6-3.6l-1 1.7c-2.8-.6-5.7.4-8 2.7 2 3.4 5.6 5.2 9.2 4.6V9.7h-2.3V8.2h4.2v8.6c-4.9 1.4-10.2-.6-12.7-4.6zm14.7-4.7v1.5c3 .5 5.2 2.9 5.4 5.9.2 3.2-2.1 5.9-5.4 6.4v1.5c4.2-.5 7.2-3.9 7-8-.2-3.9-3.1-6.9-7-7.3z"/></svg>`,
  mac: () => `<svg width="54" height="30" viewBox="0 0 60 34"><rect x="1" y="6" width="58" height="20" rx="5" fill="#e5e9ee" stroke="#94a3b8"/><circle cx="30" cy="16" r="3.4" fill="#cbd5e1"/><circle cx="50" cy="22" r="1.2" fill="#94a3b8"/></svg>`,
  // arch.html 전용
  pkg: (c = '#7c3aed', s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><path d="M3.5 7.6 12 3l8.5 4.6v8.8L12 21l-8.5-4.6z"/><path d="M7.8 5.3 16.3 10v9M3.5 7.6 12 12.2l8.5-4.6"/></svg>`,
  server: (c = '#059669', s = 34) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><rect x="3" y="3.5" width="18" height="7" rx="2"/><rect x="3" y="13.5" width="18" height="7" rx="2"/><path d="M6.6 7h.01M6.6 17h.01M10 7h5M10 17h5"/></svg>`,
  route: (c = '#2563eb', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.6 6h5.4a4 4 0 0 1 0 8H10a4 4 0 0 0 0 8h.4"/></svg>`,
  key: (c = '#0d9488', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3.4M15.5 12v2.4"/></svg>`,
  plug: (c = '#0284c7', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><path d="M9 3.5v5M15 3.5v5M6.5 8.5h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v3.5"/></svg>`,
  check: (c = '#0284c7', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="m7.8 12.2 2.8 2.8 5.6-5.8"/></svg>`,
  chat: (c = '#f59e0b', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><path d="M20.5 11.5c0 3.9-3.8 7-8.5 7-1 0-2-.1-2.9-.4L4 20l1.4-3.5a6.7 6.7 0 0 1-1.9-5c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7z"/><path d="M8.6 11.5h.01M12 11.5h.01M15.4 11.5h.01"/></svg>`,
  search: (c = '#0891b2', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 5 5"/></svg>`,
  robot: (c = '#7c3aed', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><rect x="3.5" y="7" width="17" height="12" rx="3.5"/><path d="M12 3.5V7"/><circle cx="8.8" cy="12.6" r="1.2" fill="${c}" stroke="none"/><circle cx="15.2" cy="12.6" r="1.2" fill="${c}" stroke="none"/><path d="M9.5 16h5"/></svg>`,
  tools: (c = '#e11d48', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><path d="M14.5 6.2a3.8 3.8 0 0 0 5 5l-8.6 8.6a2.4 2.4 0 0 1-3.4-3.4z"/><path d="M6 4.5 8.5 7 7 8.5 4.5 6z"/></svg>`,
  clock: (c = '#64748b', s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.4 2"/></svg>`,
};

// ── 기기 일러스트 ────────────────────────────────────────────────
// 이미지 생성 대신 손으로 그린 벡터. 확대해도 뭉개지지 않고 글자가 깨지지 않는다.
window.ART = {
  macMini: (w = 132) => `<svg width="${w}" viewBox="0 0 160 108" fill="none">
    <defs>
      <linearGradient id="mmTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfefe"/><stop offset=".45" stop-color="#e8edf2"/><stop offset="1" stop-color="#cfd8e2"/></linearGradient>
      <linearGradient id="mmSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c6d0db"/><stop offset="1" stop-color="#9fadbd"/></linearGradient>
      <radialGradient id="mmGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#60a5fa" stop-opacity=".38"/><stop offset="1" stop-color="#60a5fa" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="80" cy="94" rx="66" ry="11" fill="url(#mmGlow)"/>
    <ellipse cx="80" cy="92" rx="52" ry="6" fill="#0f172a" opacity=".13"/>
    <rect x="18" y="52" width="124" height="26" rx="11" fill="url(#mmSide)"/>
    <rect x="18" y="26" width="124" height="42" rx="12" fill="url(#mmTop)" stroke="#b9c4d1"/>
    <ellipse cx="80" cy="45" rx="13" ry="5.4" fill="#aab6c4" opacity=".5"/>
    <ellipse cx="80" cy="44" rx="9" ry="3.6" fill="#8e9dae" opacity=".55"/>
    <circle cx="128" cy="66" r="2.2" fill="#22c55e"/>
    <path d="M24 66h16M46 66h10" stroke="#8fa0b3" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>
  </svg>`,
  dgx: (w = 128) => `<svg width="${w}" viewBox="0 0 160 132" fill="none">
    <defs>
      <linearGradient id="dgBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2937"/><stop offset="1" stop-color="#0b1220"/></linearGradient>
      <radialGradient id="dgGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#4ade80" stop-opacity=".4"/><stop offset="1" stop-color="#4ade80" stop-opacity="0"/></radialGradient>
      <radialGradient id="fanG" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#16a34a" stop-opacity=".55"/><stop offset=".75" stop-color="#052e16" stop-opacity=".9"/><stop offset="1" stop-color="#020617"/></radialGradient>
    </defs>
    <ellipse cx="80" cy="120" rx="62" ry="10" fill="url(#dgGlow)"/>
    <rect x="20" y="12" width="120" height="104" rx="13" fill="url(#dgBody)" stroke="#334155"/>
    <rect x="28" y="20" width="60" height="88" rx="8" fill="#0b1220" stroke="#1f2937"/>
    <rect x="34" y="27" width="20" height="26" rx="3" fill="#132033" stroke="#1f2937"/>
    <rect x="34" y="58" width="48" height="6" rx="3" fill="#132033"/>
    <rect x="34" y="69" width="38" height="6" rx="3" fill="#132033"/>
    <rect x="34" y="80" width="44" height="6" rx="3" fill="#132033"/>
    <circle cx="62" cy="40" r="9" fill="none" stroke="#22c55e" stroke-width="1.6" opacity=".8"/>
    <circle cx="62" cy="40" r="4" fill="#22c55e" opacity=".55"/>
    <circle cx="114" cy="38" r="15" fill="url(#fanG)" stroke="#1f2937"/>
    <circle cx="114" cy="76" r="15" fill="url(#fanG)" stroke="#1f2937"/>
    <g stroke="#22c55e" stroke-width="1.1" opacity=".5">
      <path d="M114 25v26M101 38h26M105 29l18 18M123 29l-18 18"/>
      <path d="M114 63v26M101 76h26M105 67l18 18M123 67l-18 18"/>
    </g>
    <circle cx="132" cy="108" r="2.4" fill="#22c55e"/>
  </svg>`,
};
