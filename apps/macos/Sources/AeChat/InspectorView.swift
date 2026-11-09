import AeChatKit
import SwiftUI

struct InspectorView: View {
    @EnvironmentObject private var state: AppState
    @AppStorage("AeChatUse24Hour") private var use24Hour = true

    var body: some View {
        Group {
            if let log = state.selectedLog {
                content(log)
            } else if let error = state.logError {
                ContentUnavailableView(
                    "Audit unavailable",
                    systemImage: "exclamationmark.triangle",
                    description: Text(error)
                )
            } else if state.selectedMessageId != nil {
                ProgressView("Loading audit chain…")
            } else {
                ContentUnavailableView(
                    "Nothing selected",
                    systemImage: "sidebar.right",
                    description: Text(
                        "Select a message to inspect delivery, request and audit state.")
                )
            }
        }
        .navigationTitle("Inspector")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    state.selectMessage(nil)
                } label: {
                    Label("Close inspector", systemImage: "xmark.circle")
                }
                .keyboardShortcut(.escape, modifiers: [])
            }
        }
    }

    private func content(_ log: UiLog) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                section("Message") {
                    fact("id", log.messageId, monospaced: true)
                    fact("kind", log.kind)
                    fact("from", state.displayName(for: log.fromSession))
                    fact("to", state.displayName(for: log.toSession))
                    fact("request id", log.requestId ?? "—", monospaced: true)
                }
                section("Delivery") {
                    fact("id", log.deliveryId ?? "—", monospaced: true)
                    fact("status", log.deliveryStatus ?? "—")
                    fact("attempts", log.attempts.map(String.init) ?? "—")
                    if let error = log.lastError, !error.isEmpty {
                        fact("last error", Display.sanitizedBody(error))
                    }
                }
                section("Request") {
                    fact("status", log.requestStatus ?? "—")
                    fact("deadline", Display.timestamp(log.requestDeadline))
                    fact("close reason", log.requestCloseReason ?? "—")
                    fact("reply", log.replyMessageId ?? "—", monospaced: true)
                }
                section("Audit chain") {
                    ForEach(Array(log.chain.enumerated()), id: \.offset) { _, event in
                        chainRow(event)
                    }
                }
            }
            .padding(Theme.Spacing.medium)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
            Text(title)
                .font(Theme.Typography.sectionTitle)
            content()
        }
    }

    private func fact(_ label: String, _ value: String, monospaced: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.small) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 78, alignment: .leading)
            Text(value)
                .font(monospaced ? .caption.monospaced() : .caption)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func chainRow(_ event: UiAuditEvent) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
            HStack(spacing: Theme.Spacing.small) {
                Text(event.stage)
                    .font(.caption.monospaced())
                Text(event.event)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(Display.timestamp(event.ts))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let error = event.errorDetail, !error.isEmpty {
                Text(Display.sanitizedBody(error))
                    .font(.caption2)
                    .foregroundStyle(Theme.Palette.failure)
            }
        }
        .padding(.vertical, Theme.Spacing.xSmall)
    }
}
