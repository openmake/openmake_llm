// 병렬 서브에이전트 진행 패널 — 웹 components/agent-tasks/subagent-panel.tsx 대응(#813).
import SwiftUI
import OpenMakeKit

struct SubagentPanel: View {
    let traces: [SubagentTrace]

    var body: some View {
        if !traces.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("병렬 에이전트 \(traces.count)개")
                        .font(.headline)
                        .foregroundStyle(Instrument.fg)
                    Spacer()
                    Text("\(traces.filter { $0.status == "completed" }.count)/\(traces.count) 완료")
                        .font(Instrument.mono(size: 11.5))
                        .foregroundStyle(Instrument.muted)
                }
                ForEach(traces) { trace in
                    HStack(alignment: .top, spacing: 10) {
                        LumenDot(color: color(for: trace.status), size: 7, pulsing: trace.status == "running")
                            .padding(.top, 6)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(trace.displayName)
                                    .font(.system(size: 13.5, weight: .semibold))
                                    .foregroundStyle(Instrument.fg)
                                    .lineLimit(1)
                                Text(trace.statusLabel)
                                    .font(.system(size: 10.5, weight: .semibold))
                                    .foregroundStyle(color(for: trace.status))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(color(for: trace.status).opacity(0.12), in: Capsule())
                            }
                            HStack(spacing: 6) {
                                Text("\(trace.steps.count)단계")
                                if let lastTool = trace.steps.last(where: { $0.tool != nil })?.tool {
                                    Text("· \(lastTool)")
                                        .lineLimit(1)
                                }
                            }
                            .font(.system(size: 11.5))
                            .foregroundStyle(Instrument.muted)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(10)
                    .background(Instrument.surface, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Instrument.border))
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("병렬 에이전트 \(traces.count)개")
        }
    }

    private func color(for status: String) -> Color {
        switch status {
        case "completed": Instrument.success
        case "failed": Instrument.danger
        case "interrupted": Instrument.warn
        case "running": Instrument.accent
        default: Instrument.faint
        }
    }
}
