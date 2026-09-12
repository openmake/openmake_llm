// 멀티모달 오케스트레이터 진행 카드 — 계획/실행/종합 단계와 capability 작업별 상태.
// 웹의 진행 배너(store.orchestratorProgress) 대응. 이미지 34s·영상 수 분 동안 "무엇을 하고
// 있는지"를 보여야 멈춘 것처럼 보이지 않는다(2026-09-12 iOS 격차).
import SwiftUI
import OpenMakeKit

struct OrchestratorProgressCard: View {
    let progress: OrchestratorProgress

    private var phaseTitle: String {
        switch progress.phase {
        case .planning: "질문을 분석하고 있어요"
        case .executing: "작업을 실행하고 있어요"
        case .synthesizing: "답변을 작성하고 있어요"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Instrument.second)
                Text(phaseTitle)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(Instrument.fg2)
                Spacer(minLength: 4)
                if !progress.tasks.isEmpty {
                    Text("\(progress.doneCount)/\(progress.tasks.count)")
                        .font(Instrument.mono(size: 11.5))
                        .foregroundStyle(Instrument.muted)
                        .monospacedDigit()
                }
            }
            ForEach(progress.tasks) { task in
                HStack(alignment: .top, spacing: 8) {
                    statusIcon(task.status)
                        .frame(width: 14, height: 14)
                        .padding(.top, 1)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(task.label)
                                .font(.system(size: 12.5, weight: .medium))
                                .foregroundStyle(Instrument.fg)
                            if let ms = task.ms, task.status == .ok || task.status == .failed {
                                Text(durationText(ms))
                                    .font(Instrument.mono(size: 11))
                                    .foregroundStyle(Instrument.muted)
                            }
                        }
                        if let detail = task.summary ?? task.instruction, !detail.isEmpty {
                            Text(detail)
                                .font(.system(size: 11.5))
                                .foregroundStyle(task.status == .failed ? Instrument.danger : Instrument.muted)
                                .lineLimit(2)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Instrument.secondSoft, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Instrument.border))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("멀티모달 작업 \(progress.doneCount)/\(progress.tasks.count) 완료, \(phaseTitle)")
    }

    @ViewBuilder
    private func statusIcon(_ status: OrchestratorTask.Status) -> some View {
        switch status {
        case .pending:
            Image(systemName: "circle.dotted")
                .font(.system(size: 11))
                .foregroundStyle(Instrument.faint)
        case .running:
            LumenDot(color: Instrument.accent, size: 7, pulsing: true)
        case .ok:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(Instrument.success)
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(Instrument.danger)
        }
    }

    private func durationText(_ ms: Double) -> String {
        let seconds = ms / 1000
        if seconds < 60 { return String(format: "%.0f초", seconds) }
        return "\(Int(seconds) / 60)분 \(Int(seconds) % 60)초"
    }
}
