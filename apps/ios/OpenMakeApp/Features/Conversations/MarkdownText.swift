// 마크다운 렌더러 — 서드파티 0 원칙: 코드펜스는 수동 분리, 인라인은 AttributedString(markdown:)
import SwiftUI
import UIKit
import OpenMakeKit

struct MarkdownText: View {
    let content: String

    private enum BlockSegment {
        case text(String)
        case code(language: String?, body: String)
    }

    var body: some View {
        // 아티팩트 placeholder 는 걷어낸다 — 아티팩트는 별도 카드로 표시된다
        let source = MarkdownContentParser.strippingArtifactPlaceholders(content)
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownContentParser.segments(in: source).enumerated()), id: \.offset) { _, segment in
                switch segment {
                case .text(let text):
                    textBlocks(text)
                case .image(let alt, let source):
                    GeneratedImageView(alt: alt, source: source)
                }
            }
        }
    }

    @ViewBuilder
    private func textBlocks(_ text: String) -> some View {
        ForEach(Array(blocks(in: text).enumerated()), id: \.offset) { _, segment in
            switch segment {
            case .text(let text):
                RichTextBlock(text: text)
            case .code(let language, let body):
                // ```kakaomap 은 지도 카드로 — 그대로 두면 좌표 JSON 이 노출된다
                if language == KakaoMapBlock.language, let payload = KakaoMapBlock.parse(body) {
                    KakaoMapCard(payload: payload)
                } else {
                    CodeBlockView(language: language, code: body)
                }
            }
        }
    }

    private func blocks(in text: String) -> [BlockSegment] {
        var result: [BlockSegment] = []
        var currentText: [String] = []
        var codeLines: [String] = []
        var codeLanguage: String?
        var inCode = false

        for line in text.components(separatedBy: "\n") {
            if line.hasPrefix("```") {
                if inCode {
                    result.append(.code(language: codeLanguage, body: codeLines.joined(separator: "\n")))
                    codeLines = []
                    inCode = false
                } else {
                    let text = currentText.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty { result.append(.text(text)) }
                    currentText = []
                    let lang = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
                    codeLanguage = lang.isEmpty ? nil : lang
                    inCode = true
                }
            } else if inCode {
                codeLines.append(line)
            } else {
                currentText.append(line)
            }
        }
        if inCode {
            // 스트리밍 중 미완성 펜스 — 코드로 표시
            result.append(.code(language: codeLanguage, body: codeLines.joined(separator: "\n")))
        } else {
            let text = currentText.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { result.append(.text(text)) }
        }
        return result
    }

}

/// 블록 마크다운 렌더 — 헤딩·불릿/번호 리스트·인용·구분선을 실제 서식으로 표시한다.
/// (인라인 전용 렌더만 쓰면 "*   항목", "---", "## 제목" 이 raw 로 노출된다 — 2026-08-17 수정)
private struct RichTextBlock: View {
    let text: String

    private enum Line: Identifiable {
        case heading(level: Int, text: String)
        case bullet(text: String, depth: Int)
        case numbered(marker: String, text: String, depth: Int)
        case quote(text: String)
        case divider
        case paragraph(text: String)
        case table(MarkdownTable)

        var id: String { String(describing: self) + UUID().uuidString }
    }

    /// 접힌 섹션 제목 — 헤딩 탭으로 토글. 긴 답변에서 필요한 부분만 펼쳐 읽는다.
    @State private var collapsed: Set<String> = []

    var body: some View {
        let lines = parse()
        let sections = sectionize(lines)
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                if let heading = section.heading {
                    sectionHeader(heading, key: section.key, hasBody: !section.body.isEmpty)
                }
                if section.heading == nil || !collapsed.contains(section.key) {
                    ForEach(Array(section.body.enumerated()), id: \.offset) { _, line in
                        render(line)
                    }
                }
            }
        }
    }

    private struct Section {
        let heading: (level: Int, text: String)?
        let body: [Line]
        /// 접힘 상태 키 — 같은 제목이 반복돼도 순서로 구분
        let key: String
    }

    /// 헤딩 기준 섹션 묶기 — 헤딩 앞 도입부는 heading nil 섹션으로 항상 펼쳐 둔다.
    private func sectionize(_ lines: [Line]) -> [Section] {
        var sections: [Section] = []
        var currentHeading: (level: Int, text: String)?
        var buffer: [Line] = []
        var index = 0

        func flush() {
            guard currentHeading != nil || !buffer.isEmpty else { return }
            sections.append(Section(
                heading: currentHeading,
                body: buffer,
                key: "\(index)-\(currentHeading?.text ?? "")"))
            index += 1
            buffer = []
        }

        for line in lines {
            if case .heading(let level, let text) = line {
                flush()
                currentHeading = (level, text)
            } else {
                buffer.append(line)
            }
        }
        flush()
        return sections
    }

    /// 헤딩 + 접기 chevron. 섹션이 비어 있으면 토글하지 않는다.
    @ViewBuilder
    private func sectionHeader(_ heading: (level: Int, text: String), key: String, hasBody: Bool) -> some View {
        let isCollapsed = collapsed.contains(key)
        Button {
            guard hasBody else { return }
            withAnimation(.easeInOut(duration: 0.15)) {
                if isCollapsed { collapsed.remove(key) } else { collapsed.insert(key) }
            }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(inline(heading.text))
                    .font(Instrument.display(
                        size: heading.level <= 1 ? 20 : (heading.level == 2 ? 17.5 : 16),
                        weight: .semibold))
                    .kerning((heading.level <= 1 ? 20 : (heading.level == 2 ? 17.5 : 16)) * Instrument.headingTracking)
                    .foregroundStyle(Instrument.fg)
                    .multilineTextAlignment(.leading)
                if hasBody {
                    Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Instrument.faint)
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(hasBody ? (isCollapsed ? "펼치기" : "접기") : "")
    }

    @ViewBuilder
    private func render(_ line: Line) -> some View {
        switch line {
        case .heading(let level, let text):
            Text(inline(text))
                .font(Instrument.display(size: level <= 1 ? 20 : (level == 2 ? 17.5 : 16), weight: .semibold))
                .kerning((level <= 1 ? 20 : (level == 2 ? 17.5 : 16)) * Instrument.headingTracking)
                .foregroundStyle(Instrument.fg)
                .padding(.top, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
        default:
            legacyRender(line)
        }
    }

    @ViewBuilder
    private func legacyRender(_ line: Line) -> some View {
        Group {
            switch line {
                case .heading(let level, let text):
                    Text(inline(text))
                        .font(Instrument.display(size: level <= 1 ? 20 : (level == 2 ? 17.5 : 16), weight: .semibold))
                .kerning((level <= 1 ? 20 : (level == 2 ? 17.5 : 16)) * Instrument.headingTracking)
                        .foregroundStyle(Instrument.fg)
                        .padding(.top, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                case .bullet(let text, let depth):
                    listRow(marker: "•", text: text, depth: depth)
                case .numbered(let marker, let text, let depth):
                    listRow(marker: marker, text: text, depth: depth)
                case .quote(let text):
                    HStack(alignment: .top, spacing: 8) {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(Instrument.accent.opacity(0.5))
                            .frame(width: 3)
                        body(text).foregroundStyle(Instrument.fg2)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                case .divider:
                    Rectangle()
                        .fill(Instrument.border)
                        .frame(height: 1)
                        .padding(.vertical, 4)
                case .paragraph(let text):
                    body(text)
                case .table(let table):
                    MarkdownTableView(table: table)
                }
            }
    }

    private func listRow(marker: String, text: String, depth: Int) -> some View {
        HStack(alignment: .top, spacing: 7) {
            Text(marker)
                .font(.system(size: 15))
                .foregroundStyle(Instrument.muted)
                .frame(minWidth: marker == "•" ? 8 : 16, alignment: .leading)
            body(text)
        }
        .padding(.leading, CGFloat(depth) * 14)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func body(_ text: String) -> some View {
        Text(inline(text))
            .font(.system(size: 15))
            .lineSpacing(3)
            .foregroundStyle(Instrument.fg)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 인라인(굵게/기울임/코드/링크)만 해석 — 블록은 위에서 이미 분해됨
    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    /// 라인 단위 블록 분해 — 연속 문단은 하나로 합쳐 문단 간격을 유지한다.
    private func parse() -> [Line] {
        var result: [Line] = []
        var paragraph: [String] = []

        func flush() {
            let joined = paragraph.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !joined.isEmpty { result.append(.paragraph(text: joined)) }
            paragraph = []
        }

        let rawLines = text.components(separatedBy: "\n")
        var index = 0
        while index < rawLines.count {
            let rawLine = rawLines[index]
            index += 1
            let indent = rawLine.prefix { $0 == " " || $0 == "\t" }.count
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            let depth = min(indent / 2, 3)

            if line.isEmpty {
                flush()
                continue
            }
            // 표: 헤더 + |---| 구분행 — 폰에서는 카드로 재구성 (MarkdownTableView)
            if let parsed = MarkdownTableParser.parse(rawLines, from: index - 1) {
                flush()
                result.append(.table(parsed.table))
                index = (index - 1) + parsed.consumed
                continue
            }
            // 구분선: ---, ***, ___ (3자 이상)
            if line.count >= 3, line.allSatisfy({ $0 == "-" }) || line.allSatisfy({ $0 == "*" }) || line.allSatisfy({ $0 == "_" }) {
                flush()
                result.append(.divider)
                continue
            }
            // 헤딩: # ~ ######
            if line.hasPrefix("#") {
                let hashes = line.prefix { $0 == "#" }.count
                if hashes <= 6, line.dropFirst(hashes).hasPrefix(" ") {
                    flush()
                    result.append(.heading(
                        level: hashes,
                        text: String(line.dropFirst(hashes)).trimmingCharacters(in: .whitespaces)))
                    continue
                }
            }
            // 인용: >
            if line.hasPrefix(">") {
                flush()
                result.append(.quote(text: String(line.dropFirst()).trimmingCharacters(in: .whitespaces)))
                continue
            }
            // 불릿: -, *, + (뒤에 공백 필수 — 굵게(**)와 구분)
            if let first = line.first, "-*+".contains(first), line.dropFirst().hasPrefix(" ") {
                flush()
                result.append(.bullet(
                    text: String(line.dropFirst()).trimmingCharacters(in: .whitespaces),
                    depth: depth))
                continue
            }
            // 번호 리스트: 1. / 1)
            if let match = line.firstMatch(of: /^(\d{1,3})[.)]\s+(.+)$/) {
                flush()
                result.append(.numbered(
                    marker: "\(match.1).",
                    text: String(match.2),
                    depth: depth))
                continue
            }
            paragraph.append(line)
        }
        flush()
        return result
    }
}

private struct GeneratedImageView: View {
    let alt: String
    let source: String

    var body: some View {
        AsyncImage(url: imageURL) { phase in
            switch phase {
            case .empty:
                RoundedRectangle(cornerRadius: 12)
                    .fill(Instrument.surface2)
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay { ProgressView().tint(Instrument.accent) }
            case .success(let image):
                image
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Instrument.border))
            case .failure:
                ContentUnavailableView(
                    "이미지를 불러오지 못했습니다",
                    systemImage: "photo.badge.exclamationmark",
                    description: Text(source))
                    .frame(minHeight: 160)
                    .background(Instrument.surface2, in: RoundedRectangle(cornerRadius: 12))
            @unknown default:
                EmptyView()
            }
        }
        .accessibilityLabel(alt.isEmpty ? "생성된 이미지" : alt)
    }

    private var imageURL: URL? {
        GeneratedImageURLResolver.resolve(source: source, serverURL: AppConfig.serverURL)
    }
}

/// 표 → 폰 화면용 카드 목록.
/// 좁은 화면에서 열을 그대로 그리면 글자가 잘려 읽을 수 없으므로, 행을 카드로 세워
/// 첫 열을 제목, 나머지를 "헤더 · 값" 줄로 편다. 2열 표는 라벨-값 한 줄로 압축한다.
struct MarkdownTableView: View {
    let table: MarkdownTable

    private var isPair: Bool { table.headers.count == 2 }

    var body: some View {
        VStack(alignment: .leading, spacing: isPair ? 6 : 8) {
            if isPair {
                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                    HStack(alignment: .top, spacing: 8) {
                        Text(inline(row.first ?? ""))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Instrument.fg)
                            .frame(minWidth: 72, alignment: .leading)
                        Text(inline(row.count > 1 ? row[1] : ""))
                            .font(.system(size: 14))
                            .foregroundStyle(Instrument.fg2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 2)
                }
            } else {
                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(inline(row.first ?? ""))
                            .font(.system(size: 14.5, weight: .bold))
                            .foregroundStyle(Instrument.fg)
                        ForEach(Array(table.fields(of: row, skippingFirst: true).enumerated()), id: \.offset) { _, field in
                            HStack(alignment: .top, spacing: 6) {
                                Text(field.header)
                                    .font(.system(size: 11.5, weight: .semibold))
                                    .foregroundStyle(Instrument.accent)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Instrument.accentSoft, in: RoundedRectangle(cornerRadius: 5))
                                Text(inline(field.value))
                                    .font(.system(size: 13.5))
                                    .lineSpacing(2)
                                    .foregroundStyle(Instrument.fg2)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Instrument.surface, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Instrument.border))
                }
            }
        }
        .textSelection(.enabled)
        .padding(.vertical, 2)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("표 \(table.rows.count)행")
    }

    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

struct CodeBlockView: View {
    let language: String?
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language ?? "code")
                    .font(.caption2)
                    .foregroundStyle(Instrument.muted)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption2)
                        .foregroundStyle(Instrument.muted)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("코드 복사")
            }
            .padding(.leading, 12)
            .background(Instrument.surface2)

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(Instrument.mono(size: 12))
                    .foregroundStyle(Instrument.fg2)
                    .textSelection(.enabled)
                    .padding(12)
            }
        }
        .background(Instrument.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Instrument.border))
    }
}
