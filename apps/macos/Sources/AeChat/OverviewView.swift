import AeChatKit
import SwiftUI

struct OverviewView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
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
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Overview")
    }

    private func counts(_ counts: UiCounts) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Sessions")
                .font(.headline)
            Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 10) {
                GridRow {
                    metric("Total", counts.sessions)
                    metric("Online", counts.online, color: .green)
                    metric("Offline", counts.offline, color: .secondary)
                    metric("Unknown", counts.unknown, color: .orange)
                    metric("Left", counts.left, color: .purple)
                }
                GridRow {
                    metric("Pending requests", counts.pendingRequests, color: .orange)
                    metric("Pending deliveries", counts.pendingDeliveries, color: .orange)
                }
            }
        }
    }

    private func metric(_ title: String, _ value: Int, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("\(value)")
                .font(.title2.monospacedDigit())
                .foregroundStyle(color)
        }
        .frame(minWidth: 90, alignment: .leading)
    }

    private var transportModes: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Transport modes")
                .font(.headline)
            let modes = Display.transportModes(state.sessions)
            if modes.isEmpty {
                Text("No bindings")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                HStack(spacing: 16) {
                    ForEach(modes, id: \.mode) { entry in
                        HStack(spacing: 6) {
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
        VStack(alignment: .leading, spacing: 8) {
            Text("Recent activity")
                .font(.headline)
            if threads.isEmpty {
                Text("No AeChat messages")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(threads.prefix(8)) { thread in
                    Button {
                        state.selectSession(thread.participants.first?.sessionId)
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(participants(thread))
                                    .font(.callout.weight(.medium))
                                    .lineLimit(1)
                                Text(thread.lastMessage.preview)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
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
