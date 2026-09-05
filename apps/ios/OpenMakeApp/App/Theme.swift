// Instrument (계측) — iOS 토큰. 웹 apps/web/app/globals.css 의 :root / [data-theme="dark"] 와 같은 값.
// 기준안: /Volumes/MAC_APP/openmake/OpenMake Color & Type Pairings.html (2026-09-05 채택, PR #746).
// 서체: Space Grotesk(제목·라틴) · IBM Plex Mono(수치·경로) 는 번들, 본문은 시스템 서체
// (Noto Sans KR 은 무게당 수 MB 라 미번들 — 시스템 한글 서체가 Dynamic Type 과 호환).
import SwiftUI
import UIKit

enum Instrument {
    // MARK: 표면
    static let bg = dynamic(light: 0xF7F8FA, dark: 0x0D0F13)
    static let surface = dynamic(light: 0xFFFFFF, dark: 0x12151A)
    static let surface2 = dynamic(light: 0xEEF1F5, dark: 0x191D24)
    static let surface3 = dynamic(light: 0xE8EBF0, dark: 0x20252E)

    // MARK: 텍스트
    static let fg = dynamic(light: 0x14161A, dark: 0xE7EAEF)
    static let fg2 = dynamic(light: 0x3B424C, dark: 0xB5BCC7)
    static let muted = dynamic(light: 0x5C6470, dark: 0x8B93A0)
    /// 장식·비활성 아이콘 전용 — 라이트 대비 2.7:1 이라 텍스트에는 쓰지 않는다 (muted 사용).
    static let faint = dynamic(light: 0x949BA6, dark: 0x616977)

    // MARK: 경계
    static let border = dynamic(light: 0xE1E4EA, dark: 0x262B33)
    static let borderStrong = dynamic(light: 0xD5D9E0, dark: 0x343A45)

    // MARK: 강조
    static let accent = dynamic(light: 0x1F4FD8, dark: 0x5B84FF)
    static let accentFg = dynamic(light: 0xFFFFFF, dark: 0x0D0F13)
    static let accentSoft = dynamic(light: 0xE9EEFB, dark: 0x5B84FF, darkAlpha: 0.14)
    static let second = dynamic(light: 0x00A3B4, dark: 0x2FD4E4)
    static let secondSoft = dynamic(light: 0xE0F5F8, dark: 0x2FD4E4, darkAlpha: 0.14)

    // MARK: 시그널
    static let success = dynamic(light: 0x149A6B, dark: 0x3FBD8C)
    static let warn = dynamic(light: 0xB5730A, dark: 0xE0A040)
    static let danger = dynamic(light: 0xD5392F, dark: 0xF1685E)

    // MARK: 서체
    /// 제목·워드마크 — Space Grotesk, 자간 -0.03em (웹 --display / --ls-heading).
    static func display(size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .custom("Space Grotesk", size: size).weight(weight)
    }

    /// 수치·경로·코드 — IBM Plex Mono (웹 --mono).
    static func mono(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("IBM Plex Mono", size: size).weight(weight)
    }

    /// 제목 자간 계수 (웹 --ls-heading: -0.03em).
    static let headingTracking: CGFloat = -0.03

    private static func dynamic(light: UInt32, dark: UInt32, darkAlpha: CGFloat = 1) -> Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(rgb: dark, alpha: darkAlpha)
                : UIColor(rgb: light)
        })
    }
}

private extension UIColor {
    convenience init(rgb: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: alpha)
    }
}

/// 워드마크 — "Open" + accent "Make", Space Grotesk
struct Wordmark: View {
    var size: CGFloat = 17

    var body: some View {
        (Text("Open").foregroundStyle(Instrument.fg)
            + Text("Make").foregroundStyle(Instrument.accent))
            .font(Instrument.display(size: size, weight: .bold))
            .kerning(size * Instrument.headingTracking)
    }
}

/// 시그니처 모델 도트 — 스트리밍/진행 중엔 pulse
struct LumenDot: View {
    var color: Color = Instrument.accent
    var size: CGFloat = 7
    var pulsing = false

    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .opacity(pulsing && dim && !reduceMotion ? 0.25 : 1)
            .scaleEffect(pulsing && dim && !reduceMotion ? 0.7 : 1)
            .animation(
                pulsing && !reduceMotion
                    ? .easeInOut(duration: 0.6).repeatForever(autoreverses: true)
                    : .default,
                value: dim)
            .onAppear { if pulsing && !reduceMotion { dim = true } }
            .accessibilityHidden(true)
    }
}
