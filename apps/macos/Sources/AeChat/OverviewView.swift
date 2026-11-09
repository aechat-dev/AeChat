import AeChatKit
import SwiftUI

struct OverviewView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.large) {
                if let snapshot = state.snapshot {
                    health(snapshot.counts)
                    secondaryCounts(snapshot.counts)
                    recentThreads(snapshot.threads)
                    transportModes
                    Text("Updated \(Display.relative(snapshot.generatedAt))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if state.isLoading {
                    ProgressView("Loading snapshot…")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    ContentUnavailableView(
                        "No snapshot",
                        systemImage: "square.stack.3d.up.slash",
                        description: Text("Refresh to read the AeChat store.")
                    )
                }
            }
            .padding(Theme.Spacing.large)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Overview")
    }

    private func health(_ counts: UiCounts) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text("Communication")
                .font(Theme.Typography.sectionTitle)
            Grid(
                alignment: .leading,
                horizontalSpacing: Theme.Spacing.large,
                verticalSpacing: Theme.Spacing.small
            ) {
                GridRow {
                    healthMetric(
                        "Active sessions", counts.online, tone: Theme.Palette.healthy)
                    healthMetric(
                        "Pending requests", counts.pendingRequests,
                        tone: Theme.Palette.attention)
                }
                GridRow {
                    healthMetric(
                        "Pending deliveries", counts.pendingDeliveries,
                        tone: Theme.Palette.attention)
                    healthMetric(
                        "Failed deliveries", counts.failedDeliveries,
                        tone: Theme.Palette.failure)
                }
            }
        }
    }

    private func healthMetric(_ title: String, _ value: Int?, tone: Color) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
            HStack(spacing: Theme.Spacing.xSmall) {
                Circle()
                    .fill((value ?? 0) > 0 ? tone : Theme.Palette.muted)
                    .frame(width: 8, height: 8)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(value.map(String.init) ?? "—")
                .font(Theme.Typography.metric)
                .foregroundStyle(value == nil ? .secondary : .primary)
        }
        .frame(minWidth: 110, alignment: .leading)
    }

    private func secondaryCounts(_ counts: UiCounts) -> some View {
        HStack(spacing: Theme.Spacing.medium) {
            Text("Total \(counts.sessions)")
            Text("Offline \(counts.offline)")
            Text("Unknown \(counts.unknown)")
            Text("Left \(counts.left)")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private var transportModes: some View {
        let modes = Display.transportModes(state.sessions)
        if !modes.isEmpty {
            Text(
                "Transport · "
                    + modes.map { "\($0.mode) \($0.count)" }.joined(separator: " · ")
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private func recentThreads(_ threads: [ThreadSummary]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text("Recent activity")
                .font(Theme.Typography.sectionTitle)
            if threads.isEmpty {
                Text("No AeChat messages")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(threads.prefix(8)) { thread in
                    Button {
                        state.selectSession(thread.participants.first?.sessionId)
                    } label: {
                        HStack(alignment: .top, spacing: Theme.Spacing.small) {
                            VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
                                Text(participants(thread))
                                    .font(.callout.weight(.medium))
                                    .lineLimit(1)
                                Text(thread.lastMessage.preview)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: Theme.Spacing.xSmall) {
                                Text(thread.lastMessage.kind)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                                Text(Display.relative(thread.lastMessageAt))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
            }
        }
    }

    private func participants(_ thread: ThreadSummary) -> String {
        thread.participants.map(\.displayName).joined(separator: " ↔ ")
    }
}
