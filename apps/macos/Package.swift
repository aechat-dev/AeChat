// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AeChat",
    platforms: [.macOS(.v14)],
    targets: [
        .target(
            name: "AeChatKit",
            path: "Sources/AeChatKit",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "AeChat",
            dependencies: ["AeChatKit"],
            path: "Sources/AeChat",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // XCTest and Swift Testing are unavailable with Command Line Tools
        // only, so checks are a small executable run by scripts/check-macos.sh.
        .executableTarget(
            name: "AeChatChecks",
            dependencies: ["AeChatKit"],
            path: "Tests/AeChatChecks",
            resources: [.copy("Fixtures")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
