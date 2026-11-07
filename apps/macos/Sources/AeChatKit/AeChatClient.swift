import Darwin
import Foundation

public enum AeChatClientError: LocalizedError {
    case binaryNotFound
    case nodeNotFound
    case launchFailed(String)
    case api(code: String, message: String)
    case processFailed(status: Int32, stderr: String)
    case invalidOutput(String)

    public var errorDescription: String? {
        switch self {
        case .binaryNotFound:
            return "aechat CLI not found. Set AECHAT_BIN or install aechat on PATH."
        case .nodeNotFound:
            return "Node.js not found for the bundled aechat CLI. Set AECHAT_NODE or install node on PATH."
        case .launchFailed(let message):
            return "Could not launch aechat: \(message)"
        case .api(let code, let message):
            return "\(code): \(message)"
        case .processFailed(let status, let stderr):
            let detail = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            return detail.isEmpty
                ? "aechat exited with status \(status)"
                : "aechat exited with status \(status): \(detail)"
        case .invalidOutput(let message):
            return "Unexpected aechat output: \(message)"
        }
    }
}

public struct LaunchCommand: Equatable, Sendable {
    public let executable: URL
    public let arguments: [String]

    public init(executable: URL, arguments: [String]) {
        self.executable = executable
        self.arguments = arguments
    }
}

private final class RunningProcesses: @unchecked Sendable {
    static let shared = RunningProcesses()

    private let lock = NSLock()
    private var processes: [Int32: Process] = [:]

    func add(_ process: Process) {
        lock.lock()
        processes[process.processIdentifier] = process
        lock.unlock()
    }

    func remove(_ process: Process) {
        lock.lock()
        processes.removeValue(forKey: process.processIdentifier)
        lock.unlock()
    }

    func terminateAll() {
        lock.lock()
        let running = Array(processes.values)
        processes.removeAll()
        lock.unlock()
        for process in running where process.isRunning {
            AeChatClient.terminateProcess(process)
        }
    }
}

public struct AeChatClient {
    public init(binary: URL) { self.binary = binary }
    public let binary: URL

    public static func locateBinary(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL? {
        if let explicit = environment["AECHAT_BIN"], !explicit.isEmpty {
            let url = URL(fileURLWithPath: explicit)
            if FileManager.default.isExecutableFile(atPath: url.path) {
                return url
            }
        }

        if let bundled = Bundle.main.resourceURL?
            .appendingPathComponent("cli/cli/main.js"),
           FileManager.default.isExecutableFile(atPath: bundled.path) {
            return bundled
        }

        for directory in (environment["PATH"] ?? "").split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent("aechat")
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }

    /// A `.js` CLI is a Node script with an `#!/usr/bin/env node` shebang.
    /// Finder-launched apps get a minimal PATH without the user's Node install,
    /// so resolve Node explicitly instead of relying on the shebang.
    public static func launchCommand(
        for binary: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> LaunchCommand {
        guard requiresNode(binary) else {
            return LaunchCommand(executable: binary, arguments: [])
        }
        guard let node = locateNode(environment: environment) else {
            throw AeChatClientError.nodeNotFound
        }
        return LaunchCommand(executable: node, arguments: [binary.path])
    }

    static func requiresNode(_ binary: URL) -> Bool {
        if ["js", "mjs", "cjs"].contains(binary.pathExtension.lowercased()) {
            return true
        }
        guard let handle = try? FileHandle(forReadingFrom: binary) else {
            return false
        }
        defer { try? handle.close() }
        let data = (try? handle.read(upToCount: 128)) ?? Data()
        let firstLine = String(data: data, encoding: .utf8)?
            .split(separator: "\n", maxSplits: 1)
            .first ?? ""
        return firstLine.hasPrefix("#!") && firstLine.contains("node")
    }

    public static func locateNode(environment: [String: String]) -> URL? {
        let manager = FileManager.default
        if let explicit = environment["AECHAT_NODE"], !explicit.isEmpty {
            let url = URL(fileURLWithPath: explicit)
            if manager.isExecutableFile(atPath: url.path) {
                return url
            }
        }
        for directory in (environment["PATH"] ?? "").split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent("node")
            if manager.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        let home = environment["HOME"] ?? NSHomeDirectory()
        for candidate in versionedNodeCandidates(home: home) {
            if manager.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        for path in [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
            "\(home)/.volta/bin/node",
        ] {
            if manager.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }
        return nil
    }

    /// Finder launches do not source the user's shell profile, so look at the
    /// version manager layouts directly (fnm, nvm), newest version first.
    static func versionedNodeCandidates(home: String) -> [URL] {
        let suites = [
            URL(fileURLWithPath: home).appendingPathComponent(".local/share/fnm/node-versions"),
            URL(fileURLWithPath: home).appendingPathComponent(".nvm/versions/node"),
        ]
        var candidates: [URL] = []
        for suite in suites {
            let entries = (try? FileManager.default.contentsOfDirectory(
                at: suite,
                includingPropertiesForKeys: nil
            )) ?? []
            for entry in entries.sorted(by: {
                Self.isNewerVersion($0.lastPathComponent, than: $1.lastPathComponent)
            }) {
                candidates.append(entry.appendingPathComponent("installation/bin/node"))
                candidates.append(entry.appendingPathComponent("bin/node"))
            }
        }
        return candidates
    }

    /// Compare `v24.21.0`-style directory names numerically, so v9 does not
    /// win over v24.
    static func isNewerVersion(_ left: String, than right: String) -> Bool {
        let leftParts = versionParts(left)
        let rightParts = versionParts(right)
        for index in 0..<max(leftParts.count, rightParts.count) {
            let leftValue = index < leftParts.count ? leftParts[index] : 0
            let rightValue = index < rightParts.count ? rightParts[index] : 0
            if leftValue != rightValue {
                return leftValue > rightValue
            }
        }
        return left > right
    }

    private static func versionParts(_ value: String) -> [Int] {
        value
            .drop(while: { $0 == "v" || $0 == "V" })
            .split(separator: ".")
            .map { Int($0.prefix(while: \.isNumber)) ?? 0 }
    }

    // MARK: - JSON commands

    public func snapshot() async throws -> UiSnapshot {
        try await request(["ui-snapshot", "--json"], as: UiSnapshot.self)
    }

    public func messages(
        sessionId: String,
        counterpartId: String? = nil,
        before: String? = nil,
        limit: Int? = nil
    ) async throws -> UiMessagePage {
        var arguments = ["ui-messages", "--session", sessionId, "--json"]
        if let counterpartId {
            arguments.append(contentsOf: ["--counterpart", counterpartId])
        }
        if let before {
            arguments.append(contentsOf: ["--before", before])
        }
        if let limit {
            arguments.append(contentsOf: ["--limit", String(limit)])
        }
        return try await request(arguments, as: UiMessagePage.self)
    }

    public func log(messageId: String) async throws -> UiLog {
        try await request(["ui-log", "--message", messageId, "--json"], as: UiLog.self)
    }

    public func doctor() async throws -> UiDoctor {
        try await request(["ui-doctor", "--json"], as: UiDoctor.self)
    }

    private func request<T: Decodable>(_ arguments: [String], as type: T.Type) async throws -> T {
        let result = try await Self.execute(binary: binary, arguments: arguments)
        guard result.status == 0 else {
            throw Self.error(from: result)
        }
        return try Self.decode(result.stdout, as: type)
    }

    // MARK: - Event stream

    public func events(after sequence: Int) -> AsyncThrowingStream<UiEventLine, Error> {
        AsyncThrowingStream { continuation in
            let command: LaunchCommand
            do {
                command = try Self.launchCommand(for: binary)
            } catch {
                continuation.finish(throwing: error)
                return
            }

            let process = Process()
            process.executableURL = command.executable
            process.arguments = command.arguments + ["ui-events", "--after", String(sequence)]

            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr

            let accumulator = LineAccumulator()
            stdout.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                for line in accumulator.append(data) {
                    do {
                        continuation.yield(try Self.decodeLine(line))
                    } catch {
                        stdout.fileHandleForReading.readabilityHandler = nil
                        if process.isRunning {
                            Self.terminateProcess(process)
                        }
                        continuation.finish(throwing: error)
                        return
                    }
                }
            }

            process.terminationHandler = { finished in
                stdout.fileHandleForReading.readabilityHandler = nil
                let errorData = stderr.fileHandleForReading.readDataToEndOfFile()
                if finished.terminationStatus == 0 {
                    continuation.finish()
                } else {
                    continuation.finish(
                        throwing: Self.error(
                            from: ExecutionResult(
                                stdout: Data(),
                                stderr: errorData,
                                status: finished.terminationStatus
                            )
                        )
                    )
                }
            }

            continuation.onTermination = { _ in
                stdout.fileHandleForReading.readabilityHandler = nil
                if process.isRunning {
                    Self.terminateProcess(process)
                }
            }

            do {
                try process.run()
            } catch {
                continuation.finish(throwing: AeChatClientError.launchFailed(error.localizedDescription))
            }
        }
    }

    // MARK: - Process helpers

    public struct ExecutionResult {
        public let stdout: Data
        public let stderr: Data
        public let status: Int32

        public init(stdout: Data, stderr: Data, status: Int32) {
            self.stdout = stdout
            self.stderr = stderr
            self.status = status
        }
    }

    /// Stop every short-lived bridge process (snapshot/messages/log/doctor)
    /// when the app is quitting.
    public static func terminateActiveProcesses() {
        RunningProcesses.shared.terminateAll()
    }

    /// Stop the stream child. SIGTERM is delivered first; SIGKILL is the
    /// fallback because GUI signal handling can leave SIGTERM ignored in the
    /// spawned process.
    static func terminateProcess(_ process: Process) {
        guard process.isRunning else { return }
        process.terminate()
        let identifier = process.processIdentifier
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) {
            if process.isRunning {
                kill(identifier, SIGKILL)
            }
        }
    }

    public static func execute(
        binary: URL,
        arguments: [String],
        timeout: TimeInterval = 20,
        environment: [String: String]? = nil
    ) async throws -> ExecutionResult {
        let command = try launchCommand(
            for: binary,
            environment: environment ?? ProcessInfo.processInfo.environment
        )
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = command.executable
                process.arguments = command.arguments + arguments
                if let environment {
                    process.environment = environment
                }
                let stdout = Pipe()
                let stderr = Pipe()
                process.standardOutput = stdout
                process.standardError = stderr

                do {
                    try process.run()
                } catch {
                    continuation.resume(
                        throwing: AeChatClientError.launchFailed(error.localizedDescription)
                    )
                    return
                }
                RunningProcesses.shared.add(process)

                let watchdog = DispatchWorkItem {
                    if process.isRunning {
                        AeChatClient.terminateProcess(process)
                    }
                }
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: watchdog)

                // Read both pipes concurrently: a CLI that fills stderr while
                // stdout is being drained must not deadlock.
                let errorBox = DataBox()
                let group = DispatchGroup()
                group.enter()
                DispatchQueue.global(qos: .userInitiated).async {
                    errorBox.data = stderr.fileHandleForReading.readDataToEndOfFile()
                    group.leave()
                }
                let output = stdout.fileHandleForReading.readDataToEndOfFile()
                group.wait()
                process.waitUntilExit()
                RunningProcesses.shared.remove(process)
                watchdog.cancel()
                let errorOutput = errorBox.data

                continuation.resume(
                    returning: ExecutionResult(
                        stdout: output,
                        stderr: errorOutput,
                        status: process.terminationStatus
                    )
                )
            }
        }
    }

    static func error(from result: ExecutionResult) -> Error {
        if let envelope = try? decoder().decode(APIEnvelope<EmptyPayload>.self, from: result.stderr),
           let apiError = envelope.error {
            return AeChatClientError.api(code: apiError.code, message: apiError.message)
        }
        return AeChatClientError.processFailed(
            status: result.status,
            stderr: String(data: result.stderr, encoding: .utf8) ?? ""
        )
    }

    public static func decode<T: Decodable>(_ data: Data, as type: T.Type) throws -> T {
        let envelope: APIEnvelope<T>
        do {
            envelope = try decoder().decode(APIEnvelope<T>.self, from: data)
        } catch {
            throw AeChatClientError.invalidOutput(error.localizedDescription)
        }
        if let apiError = envelope.error {
            throw AeChatClientError.api(code: apiError.code, message: apiError.message)
        }
        guard let payload = envelope.data else {
            throw AeChatClientError.invalidOutput("missing data")
        }
        return payload
    }

    public static func decodeLine(_ data: Data) throws -> UiEventLine {
        do {
            return try decoder().decode(UiEventLine.self, from: data)
        } catch {
            throw AeChatClientError.invalidOutput(error.localizedDescription)
        }
    }

    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

private struct EmptyPayload: Decodable {}

private final class DataBox: @unchecked Sendable {
    var data = Data()
}

private final class LineAccumulator {
    private var buffer = Data()

    func append(_ data: Data) -> [Data] {
        buffer.append(data)
        var lines: [Data] = []
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<newline]
            if !line.isEmpty {
                lines.append(Data(line))
            }
            buffer.removeSubrange(buffer.startIndex...newline)
        }
        return lines
    }
}
