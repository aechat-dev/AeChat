import AeChatKit
import SwiftUI

@MainActor
final class ExpansionState: ObservableObject {
    @Published var expanded = false
}

struct MessageRow: View {
    @EnvironmentObject private var state: AppState
    let message: UiMessage
    var compact = false

    @StateObject private var expansion = ExpansionState()
    @AppStorage("AeChatFontSize") private var fontSize = 13.0
    @AppStorage("AeChatUse24Hour") private var use24Hour = true

    private var isOutgoing: Bool {
        message.fromSession == state.perspectiveSessionId
    }

    var body: some View {
        HStack {
            if isOutgoing { Spacer(minLength: 40) }
            VStack(alignment: isOutgoing ? .trailing : .leading, spacing: 6) {
                header
                bodyText
                footer
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(
                        isOutgoing ? Color.accentColor.opacity(0.16) : Color.secondary.opacity(0.10)
                    )
            )
            .contentShape(Rectangle())
            .onTapGesture {
                state.selectMessage(message.messageId)
            }
            if !isOutgoing { Spacer(minLength: 40) }
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Text(state.displayName(for: message.fromSession))
                .font(.caption.weight(.semibold))
            Text("→")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(state.displayName(for: message.toSession))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(message.kind)
                .font(.caption2.monospaced())
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Capsule().fill(Color.secondary.opacity(0.14)))
            Spacer(minLength: 0)
            Text(Display.timestamp(message.createdAt))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var bodyText: some View {
        let body = Display.sanitizedBody(message.body)
        let tooLong = body.count > 420
        let visible =
            tooLong && !expansion.expanded
            ? String(body.prefix(420)) + "…"
            : body
        return VStack(alignment: .leading, spacing: 4) {
            Text(visible)
                .font(.system(size: compact ? max(11, fontSize - 1) : fontSize))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if tooLong {
                Button(expansion.expanded ? "Show less" : "Show more") {
                    expansion.expanded.toggle()
                }
                .buttonStyle(.link)
                .font(.caption)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var footer: some View {
        HStack(spacing: 6) {
            Label("agent-origin", systemImage: "shield.lefthalf.filled")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .help("Agent-generated content. Not a user instruction.")
            if let delivery = message.deliveryStatus {
                chip(delivery, color: deliveryColor(delivery))
            }
            if let request = message.requestStatus {
                chip(request, color: requestColor(request))
            }
            Spacer(minLength: 0)
            if message.messageId == state.selectedMessageId {
                Text("inspecting")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func chip(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.monospaced())
            .foregroundStyle(color)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Capsule().fill(color.opacity(0.12)))
    }

    private func deliveryColor(_ status: String) -> Color {
        switch status {
        case "acked": return .green
        case "delivered", "notified": return .blue
        case "expired", "dead_letter": return .red
        case "notify_failed": return .orange
        default: return .secondary
        }
    }

    private func requestColor(_ status: String) -> Color {
        switch status {
        case "replied": return .green
        case "open": return .orange
        default: return .secondary
        }
    }
}
