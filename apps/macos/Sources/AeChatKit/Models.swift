import Foundation

// MARK: - Envelope

public struct APIEnvelope<T: Decodable>: Decodable {
    public let ok: Bool
    public let data: T?
    public let error: APIError?
}

public struct APIError: Decodable, Error, LocalizedError, Equatable {
    public let code: String
    public let message: String

    public var errorDescription: String? { "\(code): \(message)" }
}

// MARK: - Snapshot

public struct UiCounts: Decodable, Equatable {
    public let sessions: Int
    public let online: Int
    public let offline: Int
    public let unknown: Int
    public let left: Int
    public let pendingRequests: Int
    public let pendingDeliveries: Int
    public let failedDeliveries: Int?
}

public struct TransportView: Decodable, Equatable {
    public let transport: String
    public let address: String
    public let mode: String?
    public let state: String
    public let lastVerifiedAt: String?
}

public struct CapabilitySet: Decodable, Equatable {
    public let pull: Bool
    public let wait: Bool
    public let notificationReceive: Bool
    public let busyReceive: Bool
    public let idleWakeup: Bool
}

public struct CapabilityReport: Decodable, Equatable {
    public let supported: CapabilitySet
    public let available: CapabilitySet
    public let wakeupLevel: String
    public let observedAt: String?
    public let conditions: [String]
    public let clientVersion: String?
}

public struct SessionView: Decodable, Identifiable, Equatable {
    public let sessionId: String
    public let displayName: String
    public let client: String
    public let project: String
    public let conversationId: String?
    public let status: String
    public let statusEvidence: String
    public let evidenceAt: String?
    public let lastSeenAt: String
    public let hostSeenAt: String?
    public let boundScope: String
    public let boundState: String
    public let boundCheckedAt: String?
    public let transports: [TransportView]
    public let capabilities: CapabilityReport

    public var id: String { sessionId }

    public var address: String? { transports.last?.address }
    public var isLeft: Bool { status == "left" }
}

public struct ThreadParticipant: Decodable, Equatable {
    public let sessionId: String
    public let displayName: String
    public let client: String
    public let project: String
}

public struct ThreadLastMessage: Decodable, Equatable {
    public let messageId: String
    public let kind: String
    public let preview: String
}

public struct ThreadSummary: Decodable, Identifiable, Equatable {
    public let key: String
    public let participants: [ThreadParticipant]
    public let lastMessageAt: String
    public let lastMessage: ThreadLastMessage
    public let pendingRequests: Int
    public let pendingDeliveries: Int

    public var id: String { key }
}

public struct UiSnapshot: Decodable, Equatable {
    public let generatedAt: String
    public let eventSeq: Int
    public let counts: UiCounts
    public let sessions: [SessionView]
    public let threads: [ThreadSummary]
}

// MARK: - Messages

public struct UiMessage: Decodable, Identifiable, Equatable {
    public let messageId: String
    public let kind: String
    public let direction: String
    public let fromSession: String
    public let toSession: String
    public let requestId: String?
    public let replyTo: String?
    public let body: String
    public let agentOrigin: Bool
    public let notAUserInstruction: Bool
    public let createdAt: String
    public let expiresAt: String?
    public let deliveryStatus: String?
    public let requestStatus: String?
    public let requestDeadline: String?
    public let requestCloseReason: String?

    public var id: String { messageId }
}

public struct UiMessagePage: Decodable, Equatable {
    public let messages: [UiMessage]
    public let nextBefore: String?
}

public struct UiAuditEvent: Decodable, Equatable {
    public let event: String
    public let stage: String
    public let ts: String
    public let level: String
    public let sessionId: String?
    public let deliveryId: String?
    public let requestId: String?
    public let errorCode: String?
    public let errorDetail: String?
}

public struct UiLog: Decodable, Equatable {
    public let messageId: String
    public let kind: String
    public let fromSession: String
    public let toSession: String
    public let requestId: String?
    public let deliveryId: String?
    public let deliveryStatus: String?
    public let attempts: Int?
    public let lastError: String?
    public let requestStatus: String?
    public let requestDeadline: String?
    public let requestCloseReason: String?
    public let replyMessageId: String?
    public let chain: [UiAuditEvent]
}

// MARK: - Events

public struct UiEventData: Decodable, Equatable {
    public let kind: String?
    public let toSession: String?
}

public struct UiEventLine: Decodable, Equatable {
    public let kind: String
    public let seq: Int?
    public let event: String?
    public let ts: String?
    public let level: String?
    public let sessionId: String?
    public let messageId: String?
    public let deliveryId: String?
    public let requestId: String?
    public let generatedAt: String?
    public let data: UiEventData?
}

// MARK: - Doctor

public struct DoctorNode: Decodable, Equatable {
    public let version: String
    public let platform: String
    public let arch: String
}

public struct DoctorAgmsg: Decodable, Equatable {
    public let checked: Bool
    public let version: String?
    public let supported: Bool?
    public let error: String?
}

public struct DoctorDatabase: Decodable, Equatable {
    public let path: String
    public let readOnly: Bool
    public let schemaVersion: Int?
    public let quickCheck: String?
    public let mode: String?
}

public struct DoctorLogs: Decodable, Equatable {
    public let path: String
    public let exists: Bool
    public let writable: Bool
    public let mode: String?
}

public struct DoctorConfig: Decodable, Equatable {
    public let home: String
    public let dbPath: String
    public let team: String
}

public struct DoctorTransport: Decodable, Equatable {
    public let name: String
    public let bindings: Int
}

public struct DoctorHostHook: Decodable, Equatable {
    public let paths: [String]
    public let configured: [String]
}

public struct UiDoctor: Decodable, Equatable {
    public let node: DoctorNode
    public let agmsg: DoctorAgmsg
    public let database: DoctorDatabase
    public let logs: DoctorLogs
    public let config: DoctorConfig
    public let transport: DoctorTransport
    public let hostHook: DoctorHostHook
}
