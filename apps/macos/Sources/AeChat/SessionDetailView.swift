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
                messageHistory(for: session)
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
            Text("Communication capabilities")
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
            Text(
                "wakeup \(report.wakeupLevel) · supported means the host declares it; available means it was observed"
            )
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
                    let isActive = thread.key == state.activeThread?.key
                    Button {
                        state.selectThread(thread)
                    } label: {
                        HStack(alignment: .top, spacing: Theme.Spacing.small) {
                            VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
                                Text(
                                    thread.participants.map(\.displayName)
                                        .joined(separator: " ↔ ")
                                )
                                .font(.callout.weight(.medium))
                                Text(thread.lastMessage.preview)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Text(
                                "\(thread.pendingRequests) req · \(thread.pendingDeliveries) del"
                            )
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                        }
                        .padding(Theme.Spacing.small)
                        .background(
                            isActive ? Theme.Palette.raisedSurface : Color.clear,
                            in: RoundedRectangle(cornerRadius: Theme.Radius.small)
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func messageHistory(for session: SessionView) -> some View {
        let messages = state.orderedMessages.filter {
            $0.fromSession == session.sessionId || $0.toSession == session.sessionId
        }
        return VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text("Open thread history")
                .font(Theme.Typography.sectionTitle)
            if state.activeThread == nil {
                Text("Select a thread above")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if messages.isEmpty && state.isLoadingMessages {
                ProgressView("Loading messages…")
                    .controlSize(.small)
            } else if messages.isEmpty {
                Text("No messages in the open thread")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(messages.suffix(8).reversed())) { message in
                    Button {
                        state.selectMessage(message.messageId)
                    } label: {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
                            HStack(spacing: Theme.Spacing.xSmall) {
                                Text(state.displayName(for: message.fromSession))
                                    .font(.caption.weight(.medium))
                                Text("→")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Text(state.displayName(for: message.toSession))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(message.kind)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(Display.relative(message.createdAt))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Text(Display.sanitizedBody(message.body))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                Text("Select a message to inspect its delivery and audit chain.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
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
