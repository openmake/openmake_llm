// LUMEN — Precision Light · iOS 토큰 (웹 openmake-newdesign-2026 index.html 과 동일 팔레트)
// 시안: OD 프로젝트 openmake-ios-lumen. 시그니처 = 모델 도트 시스템.
import SwiftUI
import UIKit

enum Lumen {
    static let bg = dynamic(light: 0xF7F8FA, dark: 0x0E1014)
    static let surface = dynamic(light: 0xFFFFFF, dark: 0x15181E)
    static let surface2 = dynamic(light: 0xF1F3F6, dark: 0x1B1F27)
    static let surface3 = dynamic(light: 0xE9ECF1, dark: 0x222732)
    static let fg = dynamic(light: 0x14161C, dark: 0xECEEF2)
    static let fg2 = dynamic(light: 0x3A3F4A, dark: 0xC3C9D2)
    static let muted = dynamic(light: 0x626B7A, dark: 0x97A0AE)
    static let faint = dynamic(light: 0x8A93A1, dark: 0x6B7480)
    static let border = dynamic(light: 0xE4E7EC, dark: 0x262B34)
    static let accent = dynamic(light: 0x2F6BFF, dark: 0x5B8CFF)
    static let accentFg = dynamic(light: 0xFFFFFF, dark: 0x0B1220)
    static let accentSoft = dynamic(light: 0xEAF1FF, dark: 0x182134)
    static let success = dynamic(light: 0x149A6B, dark: 0x3FBD8C)
    static let warn = dynamic(light: 0xB5730A, dark: 0xE0A040)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light)
        })
    }
}

private extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1)
    }
}

/// 워드마크 — "Open" + accent "Make"
struct Wordmark: View {
    var size: CGFloat = 17

    var body: some View {
        (Text("Open").foregroundStyle(Lumen.fg)
            + Text("Make").foregroundStyle(Lumen.accent))
            .font(.system(size: size, weight: .heavy, design: .default))
            .kerning(-0.3)
    }
}

/// 시그니처 모델 도트 — 스트리밍/진행 중엔 pulse
struct LumenDot: View {
    var color: Color = Lumen.accent
    var size: CGFloat = 7
    var pulsing = false

    @State private var dim = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .opacity(pulsing && dim ? 0.25 : 1)
            .scaleEffect(pulsing && dim ? 0.7 : 1)
            .animation(pulsing ? .easeInOut(duration: 0.6).repeatForever(autoreverses: true) : .default, value: dim)
            .onAppear { if pulsing { dim = true } }
    }
}
