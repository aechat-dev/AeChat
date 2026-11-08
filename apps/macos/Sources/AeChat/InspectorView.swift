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
    }

    private func content(_ log: UiLog) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
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
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
            content()
        }
    }

    private func fact(_ label: String, _ value: String, monospaced: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
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
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
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
                    .foregroundStyle(.red)
            }
        }
        .padding(.vertical, 2)
    }
}
