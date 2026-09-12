// 생성 영상·음성 카드 — 오케스트레이터가 결정적으로 붙이는 `[🎬 영상 보기](/generated/x.webm)`,
// `[🔊 …](/generated/x.wav)` 링크의 렌더. 종전엔 raw 마크다운 링크로 노출됐다(2026-09-12).
import SwiftUI
import AVKit
import OpenMakeKit

/// AVPlayer 가 재생하는 컨테이너 — WebM(VP8/VP9)은 iOS 네이티브 재생이 불가하므로 Safari/공유로 넘긴다.
private let nativePlayableVideo: Set<String> = ["mp4", "mov", "m4v"]

struct GeneratedVideoCard: View {
    let title: String
    let source: String
    @Environment(\.openURL) private var openURL

    private var url: URL? { GeneratedMediaURLResolver.resolve(source: source, serverURL: AppConfig.serverURL) }
    private var ext: String { (source.split(separator: "?").first.map(String.init) ?? source).components(separatedBy: ".").last?.lowercased() ?? "" }

    var body: some View {
        if let url {
            VStack(alignment: .leading, spacing: 8) {
                if nativePlayableVideo.contains(ext) {
                    VideoPlayer(player: AVPlayer(url: url))
                        .frame(height: 210)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    // WebM — 앱 내 재생 불가. 열기(Safari)와 공유(저장·AirDrop)로 제공한다.
                    HStack(spacing: 10) {
                        Image(systemName: "film")
                            .font(.system(size: 22))
                            .foregroundStyle(Instrument.accent)
                            .frame(width: 44, height: 44)
                            .background(Instrument.accentSoft, in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(cleanTitle)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Instrument.fg)
                            Text("\(ext.uppercased()) · 앱 내 재생이 지원되지 않아 Safari 로 엽니다")
                                .font(.system(size: 11.5))
                                .foregroundStyle(Instrument.muted)
                                .lineLimit(2)
                        }
                        Spacer(minLength: 0)
                    }
                }
                HStack(spacing: 8) {
                    Button {
                        openURL(url)
                    } label: {
                        Label("Safari 에서 열기", systemImage: "safari")
                    }
                    ShareLink(item: url) {
                        Label("공유", systemImage: "square.and.arrow.up")
                    }
                }
                .font(.system(size: 12.5, weight: .medium))
                .buttonStyle(.bordered)
                .tint(Instrument.accent)
            }
            .padding(12)
            .background(Instrument.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Instrument.border))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("생성된 영상 \(cleanTitle)")
        } else {
            // 서버 origin 밖 링크 — 자격증명 컨텍스트로 열지 않고 텍스트로만
            Text("[\(title)](\(source))")
                .font(.system(size: 15))
                .foregroundStyle(Instrument.fg)
        }
    }

    private var cleanTitle: String {
        let stripped = title.unicodeScalars.filter { !$0.properties.isEmojiPresentation }.map(String.init).joined()
        let trimmed = stripped.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "영상" : trimmed
    }
}

struct GeneratedAudioCard: View {
    let title: String
    let source: String
    @State private var player: AVPlayer?
    @State private var isPlaying = false

    private var url: URL? { GeneratedMediaURLResolver.resolve(source: source, serverURL: AppConfig.serverURL) }

    var body: some View {
        if let url {
            HStack(spacing: 12) {
                Button {
                    toggle(url: url)
                } label: {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Instrument.accentFg)
                        .frame(width: 40, height: 40)
                        .background(Instrument.accent, in: Circle())
                }
                .accessibilityLabel(isPlaying ? "일시정지" : "재생")
                VStack(alignment: .leading, spacing: 2) {
                    Text(cleanTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Instrument.fg)
                    Text(url.lastPathComponent)
                        .font(Instrument.mono(size: 11))
                        .foregroundStyle(Instrument.muted)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                ShareLink(item: url) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 14))
                        .foregroundStyle(Instrument.muted)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("음성 공유")
            }
            .padding(12)
            .background(Instrument.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Instrument.border))
            .onDisappear {
                player?.pause()
                isPlaying = false
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("생성된 음성 \(cleanTitle)")
        } else {
            Text("[\(title)](\(source))")
                .font(.system(size: 15))
                .foregroundStyle(Instrument.fg)
        }
    }

    private var cleanTitle: String {
        let stripped = title.unicodeScalars.filter { !$0.properties.isEmojiPresentation }.map(String.init).joined()
        let trimmed = stripped.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "음성" : trimmed
    }

    private func toggle(url: URL) {
        if player == nil {
            let created = AVPlayer(url: url)
            player = created
            NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime, object: created.currentItem, queue: .main
            ) { _ in
                created.seek(to: .zero)
                isPlaying = false
            }
        }
        guard let player else { return }
        if isPlaying {
            player.pause()
        } else {
            try? AVAudioSession.sharedInstance().setCategory(.playback)
            player.play()
        }
        isPlaying.toggle()
    }
}
