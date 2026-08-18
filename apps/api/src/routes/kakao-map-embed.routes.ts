/**
 * 카카오 지도 임베드 HTML — 네이티브 앱(WKWebView)이 로드한다.
 *
 * 앱이 카카오 SDK 를 직접 부르려면 JS 키를 앱 바이너리에 넣어야 하고, 카카오 콘솔의
 * 도메인 제한(JS 키 보호 수단)과도 맞지 않는다. 그래서 서버가 HTML 을 내려주고 앱은
 * 그 URL 을 웹뷰로 띄운다 — 키는 서버에만 남고 origin 도 자연히 서버 도메인이 된다.
 *
 * 장소 데이터는 URL 로 넘기지 않고, 앱이 로드 후 `window.renderKakaoMap(payload)` 로
 * 주입한다(장소 수가 늘어도 URL 길이 제한에 걸리지 않는다).
 *
 * @module routes/kakao-map-embed.routes
 */
import { Router, Request, Response } from 'express';
import { KAKAO_MAP_EMBED } from '../config/runtime-limits';

const router = Router();

/**
 * GET /embed/kakao-map
 * 인증 없이 제공한다 — 담긴 비밀은 JS 키뿐이고, 그 키는 웹 번들에도 이미 들어 있으며
 * 카카오 콘솔의 도메인 제한으로 보호된다. 장소 데이터는 응답에 포함되지 않는다.
 */
router.get('/kakao-map', (_req: Request, res: Response) => {
    const jsKey = process.env.KAKAO_JS_KEY || '';
    res.type('html');
    res.setHeader('Cache-Control', `public, max-age=${KAKAO_MAP_EMBED.CACHE_SECONDS}`);
    res.send(renderHtml(jsKey));
});

function renderHtml(jsKey: string): string {
    // jsKey 는 콘솔 발급 값이라 영숫자만 오지만, 스크립트 URL 에 넣기 전에 한 번 더 좁힌다.
    const safeKey = /^[A-Za-z0-9]{0,64}$/.test(jsKey) ? jsKey : '';
    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;}
  #map{width:100%;height:100%;}
  #err{display:none;font:13px -apple-system,system-ui,sans-serif;color:#888;padding:12px;}
</style>
</head>
<body>
<div id="map"></div>
<div id="err">지도를 불러오지 못했습니다</div>
<script>
(function(){
  var pending = null, ready = false;

  // 앱이 로드 완료 전에 호출해도 잃지 않도록 보관했다가 SDK 준비 시 그린다.
  window.renderKakaoMap = function(payload){
    if (!ready) { pending = payload; return; }
    draw(payload);
  };

  function fail(){
    document.getElementById('map').style.display='none';
    document.getElementById('err').style.display='block';
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mapStatus) {
      window.webkit.messageHandlers.mapStatus.postMessage('failed');
    }
  }

  function draw(payload){
    try {
      var places = (payload && payload.places) || [];
      var route = (payload && payload.route) || [];
      var container = document.getElementById('map');
      var first = places[0] || route[0];
      if (!first) { fail(); return; }
      var map = new kakao.maps.Map(container, {
        center: new kakao.maps.LatLng(first.lat, first.lng),
        level: ${KAKAO_MAP_EMBED.DEFAULT_LEVEL}
      });
      var bounds = new kakao.maps.LatLngBounds();
      places.forEach(function(p){
        var pos = new kakao.maps.LatLng(p.lat, p.lng);
        bounds.extend(pos);
        var marker = new kakao.maps.Marker({ map: map, position: pos, title: p.name });
        if (p.name) {
          var iw = new kakao.maps.InfoWindow({
            content: '<div style="padding:4px 8px;font-size:12px;white-space:nowrap">' +
              String(p.name).replace(/[<>&"]/g, '') + '</div>'
          });
          kakao.maps.event.addListener(marker, 'click', function(){ iw.open(map, marker); });
        }
      });
      if (route.length > 1) {
        var path = route.map(function(r){ var ll = new kakao.maps.LatLng(r.lat, r.lng); bounds.extend(ll); return ll; });
        new kakao.maps.Polyline({ map: map, path: path, strokeWeight: 4, strokeColor: '#2F6BFF', strokeOpacity: 0.9 });
      }
      if (places.length + route.length > 1) { map.setBounds(bounds); }
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mapStatus) {
        window.webkit.messageHandlers.mapStatus.postMessage('ready');
      }
    } catch (e) { fail(); }
  }

  if (!'${safeKey}') { fail(); return; }
  var s = document.createElement('script');
  s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=${safeKey}&autoload=false';
  s.async = true;
  s.onload = function(){
    if (!window.kakao || !window.kakao.maps) { fail(); return; }
    kakao.maps.load(function(){ ready = true; if (pending) draw(pending); });
  };
  s.onerror = fail;
  document.head.appendChild(s);
})();
</script>
</body>
</html>`;
}

export default router;
