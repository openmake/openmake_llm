# OpenMake 데스크톱 셸 (macOS)

운영 중인 OpenMake 웹 UI를 네이티브 macOS 창으로 여는 얇은 Electron 셸.
백엔드(API·Docker DB·원격 vLLM GPU)는 **번들하지 않고** 기존 운영에 연결만 한다.

- 기본 백엔드: 외부 Tailscale Funnel URL
- 메뉴 `백엔드` 에서 로컬(`localhost:3000`) 전환 (선택은 영속됨)

## 빌드 (배포자)

```bash
cd apps/desktop
npm install
npm run dist        # → dist/OpenMake-1.0.0-arm64.dmg
```

Apple Developer ID 서명·공증은 하지 않는 **미서명(ad-hoc)** 빌드다.
`afterPack.js` 훅이 dmg 패키징 직전 번들 전체를 `codesign --force --deep --sign -`
로 재서명한다 — 이게 없으면 번들이 봉인되지 않아(`Sealed Resources=none`) 수령자 Mac 에서
격리를 풀어도 "손상됨" 이 뜬다.

## 받는 사람 첫 실행 (중요)

이 앱은 **미서명**이라 macOS Gatekeeper 가 첫 실행을 막는다.
dmg 를 다운로드/AirDrop 하면 격리 속성이 붙어 더블클릭 시
**"손상되어 열 수 없습니다"** 로 뜬다 — 실제로 손상된 게 아니라 "신뢰 안 함" 이라는 뜻이다.

**한 번만** 아래 순서로 풀면 그 뒤로는 정상 실행된다:

1. dmg 를 열고 `OpenMake.app` 을 `응용 프로그램(/Applications)` 으로 드래그
2. **터미널**(응용 프로그램 > 유틸리티 > 터미널)에서 아래 한 줄 실행:

   ```bash
   xattr -dr com.apple.quarantine /Applications/OpenMake.app
   ```

3. 이제 Launchpad / 응용 프로그램에서 `OpenMake` 를 더블클릭하면 열린다.

> 경고 없이 깔끔하게 배포하려면 Apple Developer Program(연 $99) 가입 후
> Developer ID 서명 + notarize 가 필요하다. 현재는 무료 미서명 배포 방식이다.
