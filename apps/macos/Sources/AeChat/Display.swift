import AeChatKit
import SwiftUI

enum Display {
    static func shortSession(_ id: String) -> String {
        String(id.prefix(8))
    }

    static func timestamp(_ iso: String?) -> String {
        guard let iso else { return "—" }
        guard let date = isoDate(iso) else { return iso }
        let use24Hour = UserDefaults.standard.object(forKey: "AeChatUse24Hour") as? Bool ?? true
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.dateFormat = use24Hour ? "HH:mm" : "h:mm a"
        return formatter.string(from: date)
    }

    static func relative(_ iso: String?) -> String {
        guard let iso, let date = isoDate(iso) else { return "—" }
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        if seconds < 3_600 { return "\(seconds / 60)m ago" }
        if seconds < 86_400 { return "\(seconds / 3_600)h ago" }
        return "\(seconds / 86_400)d ago"
    }

    static func statusColor(_ status: String) -> Color {
        switch status {
        case "online": return Theme.Palette.healthy
        case "offline", "left": return Theme.Palette.muted
        default: return Theme.Palette.attention
        }
    }

    static func bindingColor(_ state: String) -> Color {
        switch state {
        case "valid": return Theme.Palette.healthy
        case "stale": return Theme.Palette.attention
        default: return Theme.Palette.failure
        }
    }

    /// Message bodies are agent text, never markup.
    static func sanitizedBody(_ text: String) -> String {
        AgentText.sanitized(text)
    }

    static func transportModes(_ sessions: [SessionView]) -> [(mode: String, count: Int)] {
        var counts: [String: Int] = [:]
        for session in sessions {
            for transport in session.transports {
                counts[transport.mode ?? "unknown", default: 0] += 1
            }
        }
        return counts.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    private static func isoDate(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }
}
