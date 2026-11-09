import AeChatKit
import SwiftUI

struct OverviewView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.large) {
                if let snapshot = state.snapshot {
                    counts(snapshot.counts)
                    transportModes
                    recentThreads(snapshot.threads)
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

    private func counts(_ counts: UiCounts) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text("Sessions")
                .font(Theme.Typography.sectionTitle)
            Grid(
                alignment: .leading,
                horizontalSpacing: Theme.Spacing.large,
                verticalSpacing: Theme.Spacing.small
            ) {
                GridRow {
                    metric("Total", counts.sessions)
                    metric("Online", counts.online)
                    metric("Offline", counts.offline)
                    metric("Unknown", counts.unknown)
                    metric("Left", counts.left)
                }
                GridRow {
                    metric("Pending requests", counts.pendingRequests)
                    metric("Pending deliveries", counts.pendingDeliveries)
                }
            }
        }
    }

    private func metric(_ title: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("\(value)")
                .font(Theme.Typography.metric)
        }
        .frame(minWidth: 90, alignment: .leading)
    }

    private var transportModes: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text("Transport modes")
                .font(Theme.Typography.sectionTitle)
            let modes = Display.transportModes(state.sessions)
            if modes.isEmpty {
                Text("No bindings")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                HStack(spacing: Theme.Spacing.medium) {
                    ForEach(modes, id: \.mode) { entry in
                        HStack(spacing: Theme.Spacing.small) {
                            Text(entry.mode)
                                .font(.caption.monospaced())
                            Text("\(entry.count)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
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
