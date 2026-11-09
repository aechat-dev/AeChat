import SwiftUI

/// Shared visual tokens. Keep colors semantic and spacing on the 4/8/16/24
/// scale; views should not introduce one-off values.
enum Theme {
    enum Palette {
        /// The single decorative accent, a warm orange.
        static let accent = Color(
            red: 199.0 / 255.0, green: 123.0 / 255.0, blue: 88.0 / 255.0)
        static let healthy = Color.green
        static let attention = Color.orange
        static let failure = Color.red
        static let muted = Color.secondary
        static let incomingSurface = Color.secondary.opacity(0.10)
        static let raisedSurface = Color.secondary.opacity(0.08)
    }

    enum Spacing {
        static let xSmall: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 16
        static let large: CGFloat = 24
    }

    enum Radius {
        static let small: CGFloat = 6
        static let medium: CGFloat = 8
        static let large: CGFloat = 10
    }

    enum Typography {
        static let screenTitle = Font.system(size: 20, weight: .semibold)
        static let sectionTitle = Font.system(size: 16, weight: .semibold)
        static let metric = Font.system(size: 20, weight: .semibold).monospacedDigit()
    }
}
