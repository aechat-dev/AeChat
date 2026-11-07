import Foundation

/// Message bodies are always agent text and must render inertly. Strip
/// control characters (keeping tab and newline) before display.
public enum AgentText {
    public static func sanitized(_ text: String) -> String {
        let scalars = text.unicodeScalars.filter { scalar in
            let value = scalar.value
            if value == 9 || value == 10 {
                return true
            }
            if value < 32 || (value >= 0x7F && value <= 0x9F) {
                return false
            }
            // Bidirectional overrides and zero-width controls can reorder or
            // hide text; they have no place in an agent message body.
            if (0x200B...0x200F).contains(value) ||
                (0x202A...0x202E).contains(value) ||
                (0x2066...0x2069).contains(value) ||
                value == 0xFEFF {
                return false
            }
            return true
        }
        return String(String.UnicodeScalarView(scalars))
    }
}
