import AeChatKit
import Foundation

var failures = 0

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        failures += 1
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
    }
}

func fixtureData() -> Data {
    guard
        let url = Bundle.module.url(
            forResource: "snapshot",
            withExtension: "json",
            subdirectory: "Fixtures"
        )
    else {
        FileHandle.standardError.write(Data("FAIL: snapshot fixture missing\n".utf8))
        exit(1)
    }
    return (try? Data(contentsOf: url)) ?? Data()
}

func testSnapshot() throws {
    let envelope = try AeChatClient.decoder().decode(
        APIEnvelope<UiSnapshot>.self,
        from: fixtureData()
    )
    check(envelope.ok, "snapshot envelope ok")
    guard let snapshot = envelope.data else {
        check(false, "snapshot data present")
        return
    }
    check(snapshot.counts.sessions == 2, "session count")
    check(snapshot.eventSeq == 12, "snapshot event seq")
    check(snapshot.counts.online == 1, "online count")
    check(snapshot.sessions.count == 2, "session rows")
    check(snapshot.sessions[0].displayName == "planner", "first session name")
    check(snapshot.sessions[0].address == "aechat-000000000001", "address")
    check(snapshot.sessions[0].capabilities.wakeupLevel == "L3", "wakeup level")
    check(
        snapshot.sessions[0].capabilities.available.notificationReceive,
        "available notification_receive"
    )
    check(snapshot.sessions[1].client == "codex", "second client")
    check(snapshot.sessions[1].transports.isEmpty, "second has no transports")

    guard let thread = snapshot.threads.first else {
        check(false, "thread present")
        return
    }
    check(thread.participants.count == 2, "thread participants")
    check(thread.lastMessage.kind == "request", "last message kind")
    check(thread.lastMessage.preview == "please run the tests", "preview")
    check(thread.pendingRequests == 1, "pending requests")
    check(thread.pendingDeliveries == 2, "pending deliveries")
}

func testErrorEnvelope() throws {
    let json = """
        {"ok":false,"error":{"code":"invalid_input","message":"missing --session"},"meta":{"schema":1}}
        """
    let envelope = try AeChatClient.decoder().decode(
        APIEnvelope<UiSnapshot>.self,
        from: Data(json.utf8)
    )
    check(!envelope.ok, "error envelope not ok")
    check(envelope.error?.code == "invalid_input", "error code")
    check(envelope.error?.message == "missing --session", "error message")
}

func testEventLines() throws {
    let event = try AeChatClient.decodeLine(
        Data(
            """
            {"kind":"event","seq":3,"event":"send","ts":"2026-11-08T00:00:00.000Z","level":"info","session_id":"s-a","message_id":"m-1","delivery_id":"d-1","request_id":null,"data":{"kind":"notify"}}
            """.utf8))
    check(event.kind == "event", "event kind")
    check(event.seq == 3, "event seq")
    check(event.event == "send", "event name")
    check(event.sessionId == "s-a", "event session")
    check(event.deliveryId == "d-1", "event delivery")

    let tick = try AeChatClient.decodeLine(
        Data(
            """
            {"kind":"snapshot","generated_at":"2026-11-08T00:00:00.000Z"}
            """.utf8))
    check(tick.kind == "snapshot", "tick kind")
    check(tick.generatedAt == "2026-11-08T00:00:00.000Z", "tick timestamp")
}

func testMessageLogDoctor() throws {
    let page = try AeChatClient.decode(
        Data(
            """
            {"ok":true,"data":{"messages":[{"message_id":"m-1","kind":"request","direction":"out","from_session":"a","to_session":"b","request_id":null,"reply_to":null,"body":"hi","agent_origin":true,"not_a_user_instruction":true,"created_at":"2026-11-08T00:00:00.000Z","expires_at":null,"delivery_status":"notified","request_status":"expired","request_deadline":"2026-11-07T23:00:00.000Z","request_close_reason":"deadline"}],"next_before":null},"meta":{"schema":1}}
            """.utf8), as: UiMessagePage.self)
    check(page.messages.first?.requestStatus == "expired", "message request status")
    check(page.messages.first?.requestCloseReason == "deadline", "message close reason")
    check(page.nextBefore == nil, "next cursor")

    let replies = try AeChatClient.decode(
        Data(
            """
            {"ok":true,"data":{"messages":[{"message_id":"m-2","kind":"reply","direction":"in","from_session":"b","to_session":"a","request_id":"m-1","reply_to":"m-1","body":"done","agent_origin":true,"not_a_user_instruction":true,"created_at":"2026-11-08T00:00:01.000Z","expires_at":null,"delivery_status":"acked","request_status":"replied","request_deadline":null,"request_close_reason":"replied"}],"next_before":"cursor"},"meta":{"schema":1}}
            """.utf8), as: UiMessagePage.self)
    check(replies.messages.first?.kind == "reply", "reply kind")
    check(replies.messages.first?.replyTo == "m-1", "reply parent")
    check(replies.messages.first?.deliveryStatus == "acked", "reply delivery")
    check(replies.nextBefore == "cursor", "reply cursor")

    let log = try AeChatClient.decode(
        Data(
            """
            {"ok":true,"data":{"message_id":"m-1","kind":"notify","from_session":"a","to_session":"b","request_id":null,"delivery_id":"d-1","delivery_status":"ack","attempts":1,"last_error":null,"request_status":null,"request_deadline":null,"request_close_reason":null,"reply_message_id":null,"chain":[{"event":"send","stage":"stored","ts":"2026-11-08T00:00:00.000Z","level":"info","session_id":"a","delivery_id":"d-1","request_id":null,"error_code":null,"error_detail":null}]},"meta":{"schema":1}}
            """.utf8), as: UiLog.self)
    check(log.chain.first?.stage == "stored", "audit chain stage")

    let doctor = try AeChatClient.decode(
        Data(
            """
            {"ok":true,"data":{"node":{"version":"v24.21.0","platform":"darwin","arch":"arm64"},"agmsg":{"checked":true,"version":"1.7.1","supported":true},"database":{"path":"/tmp/aechat.db","read_only":true,"schema_version":5,"quick_check":"ok","mode":"0600"},"logs":{"path":"/tmp/logs","exists":true,"writable":true,"mode":"0700"},"config":{"home":"/tmp","db_path":"/tmp/aechat.db","team":"aechat"},"transport":{"name":"agmsg","bindings":1},"host_hook":{"paths":["/tmp/settings.json"],"configured":[]}},"meta":{"schema":1}}
            """.utf8), as: UiDoctor.self)
    check(doctor.database.readOnly, "doctor read-only")
    check(doctor.database.schemaVersion == 5, "doctor schema")
    check(doctor.transport.name == "agmsg", "doctor transport")
}

func testBinaryLocator() throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("aechat-locator-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let binary = directory.appendingPathComponent("aechat")
    try Data("#!/bin/sh\n".utf8).write(to: binary)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: binary.path)

    check(
        AeChatClient.locateBinary(environment: ["AECHAT_BIN": binary.path])?.path == binary.path,
        "locator AECHAT_BIN"
    )
    check(
        AeChatClient.locateBinary(environment: ["PATH": directory.path])?.path == binary.path,
        "locator PATH"
    )
    check(
        AeChatClient.locateBinary(environment: ["PATH": directory.path + "/missing"]) == nil,
        "locator missing"
    )
}

func findNode() -> String? {
    let environment = ProcessInfo.processInfo.environment
    if let explicit = environment["AECHAT_NODE"], !explicit.isEmpty {
        return explicit
    }
    for directory in (environment["PATH"] ?? "").split(separator: ":") {
        let candidate = String(directory) + "/node"
        if FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
    }
    return nil
}

func testNodeLaunch() async throws {
    guard let node = findNode() else {
        print("SKIP: node not found, skipping launch check")
        return
    }
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("aechat-node-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let script = directory.appendingPathComponent("main.js")
    try Data("#!/usr/bin/env node\nconsole.log('hello from node')\n".utf8).write(to: script)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)

    let command = try AeChatClient.launchCommand(
        for: script,
        environment: ["AECHAT_NODE": node, "PATH": "/usr/bin:/bin"]
    )
    check(command.executable.path == node, "js CLI launches through node")
    check(command.arguments == [script.path], "node receives the CLI path")

    // Finder gives the app a sanitized PATH; the explicit node must still work.
    let result = try await AeChatClient.execute(
        binary: script,
        arguments: [],
        environment: ["AECHAT_NODE": node, "PATH": "/usr/bin:/bin"]
    )
    check(result.status == 0, "node CLI exit status")
    let output = String(data: result.stdout, encoding: .utf8) ?? ""
    check(output.contains("hello from node"), "node CLI stdout")

    // Finder-style environment: no shell profile, minimal PATH, HOME present.
    let finderEnvironment = [
        "HOME": NSHomeDirectory(),
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    ]
    if let discovered = AeChatClient.locateNode(environment: finderEnvironment) {
        let command = try AeChatClient.launchCommand(for: script, environment: finderEnvironment)
        check(command.executable.path == discovered.path, "finder PATH resolves node")
    } else {
        print("SKIP: no node install discoverable under HOME")
    }
}

func testAgentTextSanitizer() {
    let dirty = "hello\u{0000}\u{001B}[31m\u{202E} world\u{200B}\u{0007}\nsecond\tline"
    let clean = AgentText.sanitized(dirty)
    check(clean == "hello[31m world\nsecond\tline", "control characters stripped")
    check(!clean.contains("\u{0000}"), "null removed")
    check(!clean.contains("\u{202E}"), "bidi override removed")
    check(!clean.contains("\u{200B}"), "zero-width removed")
    check(clean.contains("\n"), "newline kept")
}

func event(_ json: String) throws -> UiEventLine {
    try AeChatClient.decodeLine(Data(json.utf8))
}

func testEventPolicy() throws {
    var policy = EventPolicy(observedSeq: 3)

    let replay = try policy.decide(
        event: event(
            """
            {"kind":"event","seq":3,"event":"send","ts":"2026-11-08T00:00:00.000Z","level":"info","session_id":"s-a","message_id":"m-1","delivery_id":null,"request_id":null,"data":{"to_session":"s-b"}}
            """),
        snapshotSeq: 3,
        threadSessionIds: ["s-a", "s-b"],
        selectedMessageId: nil
    )
    check(replay == EventDecision(), "a replayed event does nothing")

    let heartbeat = try policy.decide(
        event: event(
            """
            {"kind":"event","seq":4,"event":"heartbeat","ts":"2026-11-08T00:00:01.000Z","level":"info","session_id":"s-a","message_id":null,"delivery_id":null,"request_id":null,"data":null}
            """),
        snapshotSeq: 3,
        threadSessionIds: ["s-a", "s-b"],
        selectedMessageId: nil
    )
    check(!heartbeat.refreshSnapshot, "heartbeat does not refresh the snapshot")
    check(!heartbeat.reloadMessages, "heartbeat does not reload messages")

    let message = try policy.decide(
        event: event(
            """
            {"kind":"event","seq":5,"event":"send","ts":"2026-11-08T00:00:02.000Z","level":"info","session_id":"s-a","message_id":"m-2","delivery_id":"d-2","request_id":null,"data":{"to_session":"s-b"}}
            """),
        snapshotSeq: 3,
        threadSessionIds: ["s-a", "s-b"],
        selectedMessageId: nil
    )
    check(message.reloadMessages, "send in the active thread reloads messages")
    check(message.newActivity, "send in the active thread marks activity")
    check(message.refreshSnapshot, "send refreshes the thread summary")
    check(!message.gap, "consecutive sequence is not a gap")

    let missingCounterpart = try policy.decide(
        event: event(
            """
            {"kind":"event","seq":6,"event":"send","ts":"2026-11-08T00:00:03.000Z","level":"info","session_id":"s-a","message_id":"m-3","delivery_id":"d-3","request_id":null,"data":null}
            """),
        snapshotSeq: 3,
        threadSessionIds: ["s-a", "s-b"],
        selectedMessageId: nil
    )
    check(
        !missingCounterpart.reloadMessages,
        "a send without a counterpart is not active-thread activity"
    )

    let elsewhere = try policy.decide(
        event: event(
            """
            {"kind":"event","seq":7,"event":"send","ts":"2026-11-08T00:00:04.000Z","level":"info","session_id":"s-a","message_id":"m-4","delivery_id":"d-4","request_id":null,"data":{"to_session":"s-z"}}
            """),
        snapshotSeq: 3,
        threadSessionIds: ["s-a", "s-b"],
        selectedMessageId: nil
    )
    check(!elsewhere.reloadMessages, "a send outside the thread does not reload messages")
    check(elsewhere.refreshSnapshot, "a send outside the thread refreshes the snapshot")

    let log = try policy.decide(
        event: event(
            """
            {"kind":"event","seq":8,"event":"ack","ts":"2026-11-08T00:00:05.000Z","level":"info","session_id":"s-a","message_id":"m-2","delivery_id":"d-2","request_id":null,"data":null}
            """),
        snapshotSeq: 3,
        threadSessionIds: ["s-a", "s-b"],
        selectedMessageId: "m-2"
    )
    check(log.reloadLog, "an event for the selected message reloads the inspector")

    let gap = try policy.decide(
        event: event(
            """
            {"kind":"event","seq":11,"event":"ack","ts":"2026-11-08T00:00:06.000Z","level":"info","session_id":"s-a","message_id":null,"delivery_id":null,"request_id":null,"data":null}
            """),
        snapshotSeq: 3,
        threadSessionIds: [],
        selectedMessageId: nil
    )
    check(gap.gap, "a skipped sequence is a gap")
    check(gap.refreshSnapshot, "a gap forces a snapshot")

    var emptyPolicy = EventPolicy(observedSeq: 0)
    let firstGap = try emptyPolicy.decide(
        event: event(
            """
            {"kind":"event","seq":2,"event":"heartbeat","ts":"2026-11-08T00:00:07.000Z","level":"info","session_id":"s-a","message_id":null,"delivery_id":null,"request_id":null,"data":null}
            """),
        snapshotSeq: 0,
        threadSessionIds: [],
        selectedMessageId: nil
    )
    check(firstGap.gap, "a first event after an empty snapshot can be a gap")
    check(firstGap.refreshSnapshot, "the first-event gap forces a snapshot")

    let tick = try policy.decide(
        event: event(
            """
            {"kind":"snapshot","generated_at":"2026-11-08T00:00:08.000Z"}
            """),
        snapshotSeq: 3,
        threadSessionIds: [],
        selectedMessageId: nil
    )
    check(tick == EventDecision(), "a tick is handled by the reconcile timer")

    var stale = EventPolicy(observedSeq: 10)
    stale.reset(to: 5)
    let afterStale = try stale.decide(
        event: event(
            """
            {"kind":"event","seq":11,"event":"ack","ts":"2026-11-08T00:00:09.000Z","level":"info","session_id":"s-a","message_id":null,"delivery_id":null,"request_id":null,"data":null}
            """),
        snapshotSeq: 5,
        threadSessionIds: [],
        selectedMessageId: nil
    )
    check(!afterStale.gap, "an older snapshot does not move the cursor back")
}

func testNewestNodeWins() throws {
    let home = FileManager.default.temporaryDirectory
        .appendingPathComponent("aechat-node-versions-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: home) }

    for version in ["v9.11.2", "v24.21.0"] {
        let directory =
            home
            .appendingPathComponent(".local/share/fnm/node-versions")
            .appendingPathComponent(version)
            .appendingPathComponent("installation/bin")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let node = directory.appendingPathComponent("node")
        try Data("#!/bin/sh\n".utf8).write(to: node)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)
    }

    let located = AeChatClient.locateNode(
        environment: ["HOME": home.path, "PATH": ""]
    )
    check(
        located?.path.contains("v24.21.0") == true,
        "newest node version wins over v9"
    )
}

do {
    try testSnapshot()
    try testErrorEnvelope()
    try testEventLines()
    try testEventPolicy()
    try testMessageLogDoctor()
    try testBinaryLocator()
    testAgentTextSanitizer()
    try testNewestNodeWins()
    try await testNodeLaunch()
} catch {
    FileHandle.standardError.write(Data("FAIL: \(error)\n".utf8))
    exit(1)
}

if failures > 0 {
    FileHandle.standardError.write(Data("AeChatChecks: \(failures) failure(s)\n".utf8))
    exit(1)
}
print("AeChatChecks: all checks passed")
