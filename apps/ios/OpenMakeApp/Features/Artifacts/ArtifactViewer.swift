import SwiftUI
import UIKit
import WebKit
import OpenMakeKit

struct ArtifactDocument: Identifiable, Equatable {
    let id: String
    let kind: String
    let title: String
    let language: String?
    let content: String
    let isComplete: Bool

    init(
        id: String,
        kind: String,
        title: String,
        language: String?,
        content: String,
        isComplete: Bool
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.language = language
        self.content = content
        self.isComplete = isComplete
    }

    init(streamed: ChatArtifact) {
        self.init(
            id: streamed.id,
            kind: streamed.kind,
            title: streamed.title,
            language: streamed.language,
            content: streamed.content,
            isComplete: streamed.isComplete)
    }

    init(stored: SessionArtifact) {
        self.init(
            id: stored.id,
            kind: stored.kind,
            title: stored.title,
            language: stored.language,
            content: stored.content,
            isComplete: true)
    }
}

struct ArtifactCard: View {
    let document: ArtifactDocument
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Lumen.accent)
                    .frame(width: 34, height: 34)
                    .background(Lumen.accentSoft, in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 3) {
                    Text(document.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Lumen.fg)
                        .lineLimit(1)
                    Text(document.language ?? document.kind.uppercased())
                        .font(.caption2)
                        .foregroundStyle(Lumen.muted)
                }
                Spacer(minLength: 8)
                if document.isComplete {
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Lumen.faint)
                } else {
                    ProgressView()
                        .controlSize(.small)
                        .tint(Lumen.accent)
                }
            }
            .padding(12)
            .background(Lumen.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Lumen.border))
        }
        .buttonStyle(.plain)
        .disabled(!document.isComplete)
        .accessibilityLabel("아티팩트 \(document.title)")
        .accessibilityValue(document.isComplete ? "열기" : "생성 중")
    }

    private var symbol: String {
        switch document.kind.lowercased() {
        case "code", "react": "chevron.left.forwardslash.chevron.right"
        case "html": "safari"
        case "svg", "chart", "excalidraw": "chart.xyaxis.line"
        case "csv": "tablecells"
        case "slide": "rectangle.on.rectangle"
        default: "doc.richtext"
        }
    }
}

struct ArtifactViewer: View {
    let document: ArtifactDocument
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch document.kind.lowercased() {
                case "markdown":
                    ScrollView {
                        MarkdownText(content: document.content)
                            .padding(16)
                    }
                case "html", "svg":
                    SafeArtifactWebView(document: document)
                default:
                    ScrollView {
                        CodeBlockView(
                            language: document.language ?? document.kind,
                            code: document.content)
                            .padding(16)
                    }
                }
            }
            .background(Lumen.bg)
            .navigationTitle(document.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("완료") { dismiss() }
                }
            }
        }
    }
}

private struct SafeArtifactWebView: UIViewRepresentable {
    let document: ArtifactDocument
    @Environment(\.colorScheme) private var colorScheme

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        return WKWebView(frame: .zero, configuration: configuration)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let source: String
        if document.kind.lowercased() == "svg" {
            source = "<main>\(document.content)</main>"
        } else {
            source = document.content
        }
        let traits = UITraitCollection(
            userInterfaceStyle: colorScheme == .dark ? .dark : .light)
        let foreground = UIColor(Lumen.fg).resolvedColor(with: traits).cssColor
        let background = UIColor(Lumen.bg).resolvedColor(with: traits).cssColor
        let html = """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
        <style>body{font:16px -apple-system;margin:16px;color:\(foreground);background:\(background)}img,svg{max-width:100%;height:auto}</style>
        </head><body>\(source)</body></html>
        """
        webView.isOpaque = false
        webView.backgroundColor = UIColor(Lumen.bg).resolvedColor(with: traits)
        webView.loadHTMLString(html, baseURL: nil)
    }
}

private extension UIColor {
    var cssColor: String {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        guard getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            return "rgba(0,0,0,1)"
        }
        return String(
            format: "rgba(%d,%d,%d,%.3f)",
            Int(red * 255), Int(green * 255), Int(blue * 255), alpha)
    }
}
