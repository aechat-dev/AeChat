import AeChatKit
import SwiftUI

struct SessionDetailView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        Group {
            if let session = state.selectedSession {
                content(session)
            } else if state.isBinaryMissing {
                ContentUnavailableView(
                    "CLI required",
                    systemImage: "terminal",
                    description: Text(
                        "AeChat reads data through the aechat CLI. Choose the binary from the banner below."
                    )
                )
            } else {
                ContentUnavailableView(
                    "No session selected",
                    systemImage: "person.crop.circle.badge.questionmark",
                    description: Text("Select a session to inspect its binding and capabilities.")
                )
            }
        }
        .navigationTitle(state.selectedSession?.displayName ?? "AeChat")
    }

    private func content(_ session: SessionView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                header(session)
                capabilitySection(session.capabilities)
                threads(for: session)
            }
            .padding(Theme.Spacing.large)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func header(_ session: SessionView) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            HStack(spacing: Theme.Spacing.small) {
                Circle()
                    .fill(Display.statusColor(session.status))
                    .frame(width: 10, height: 10)
                Text(session.displayName)
                    .font(Theme.Typography.screenTitle)
                Text(session.status)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            Text("\(session.client) · \(session.project)")
                .foregroundStyle(.secondary)
            Grid(
                alignment: .leading,
                horizontalSpacing: Theme.Spacing.medium,
                verticalSpacing: Theme.Spacing.small
            ) {
                GridRow {
                    label("Session")
                    Text(Display.shortSession(session.sessionId)).monospaced()
                }
                if let address = session.address {
                    GridRow {
                        label("Address")
                        Text(address).monospaced()
                    }
                }
                GridRow {
                    label("Bound")
                    HStack(spacing: Theme.Spacing.small) {
                        Text(session.boundScope)
                        Text(session.boundState)
                            .foregroundStyle(Display.bindingColor(session.boundState))
                    }
                }
                GridRow {
                    label("Evidence")
                    Text("\(session.statusEvidence) · \(Display.relative(session.evidenceAt))")
                }
                GridRow {
                    label("Last seen")
                    Text(Display.relative(session.lastSeenAt))
                }
            }
            .font(.callout)
        }
    }

    private func capabilitySection(_ report: CapabilityReport) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text("Capabilities")
                .font(Theme.Typography.sectionTitle)
            HStack(spacing: Theme.Spacing.medium) {
                capability(
                    "pull", supported: report.supported.pull, available: report.available.pull)
                capability(
                    "wait", supported: report.supported.wait, available: report.available.wait)
                capability(
                    "notify", supported: report.supported.notificationReceive,
                    available: report.available.notificationReceive)
                capability(
                    "busy", supported: report.supported.busyReceive,
                    available: report.available.busyReceive)
                capability(
                    "idle", supported: report.supported.idleWakeup,
                    available: report.available.idleWakeup)
            }
            Text("wakeup \(report.wakeupLevel) · supported vs available")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func capability(_ name: String, supported: Bool, available: Bool) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
            Text(name)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            Text(supported ? (available ? "available" : "supported") : "no")
                .font(.caption.weight(.medium))
                .foregroundStyle(
                    supported
                        ? (available ? Theme.Palette.healthy : Theme.Palette.attention)
                        : Theme.Palette.muted)
        }
    }

    private func threads(for session: SessionView) -> some View {
        let related = (state.snapshot?.threads ?? []).filter { thread in
            thread.participants.contains { $0.sessionId == session.sessionId }
        }
        return VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text("Threads")
                .font(Theme.Typography.sectionTitle)
            if related.isEmpty {
                Text("No AeChat messages for this session")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(related) { thread in
                    HStack(alignment: .top, spacing: Theme.Spacing.small) {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
                            Text(thread.participants.map(\.displayName).joined(separator: " ↔ "))
                                .font(.callout.weight(.medium))
                            Text(thread.lastMessage.preview)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Text("\(thread.pendingRequests) req · \(thread.pendingDeliveries) del")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    Divider()
                }
            }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(width: 74, alignment: .leading)
    }
}
