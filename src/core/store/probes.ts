import type { DatabaseSync } from "node:sqlite";

import { newId } from "../ids.js";

export interface ProbeRecord {
  probeId: string;
  sessionId: string;
  client: string;
  clientVersion: string | null;
  observedLevel: string;
  busyReceive: boolean | null;
  idleWakeup: boolean | null;
  evidenceJson: string | null;
  observedAt: string;
}

export interface InsertProbeInput {
  sessionId: string;
  client: string;
  clientVersion?: string | null;
  observedLevel: string;
  busyReceive?: boolean | null;
  idleWakeup?: boolean | null;
  evidenceJson?: string | null;
  observedAt: string;
  probeId?: string;
}

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableBool(value: unknown): boolean | null {
  return value === null || value === undefined ? null : Number(value) !== 0;
}

function probeFromRow(row: Row): ProbeRecord {
  return {
    probeId: String(row["probe_id"]),
    sessionId: String(row["session_id"]),
    client: String(row["client"]),
    clientVersion: nullableString(row["client_version"]),
    observedLevel: String(row["observed_level"]),
    busyReceive: nullableBool(row["busy_receive"]),
    idleWakeup: nullableBool(row["idle_wakeup"]),
    evidenceJson: nullableString(row["evidence_json"]),
    observedAt: String(row["observed_at"]),
  };
}

export class ProbeRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  insert(input: InsertProbeInput): ProbeRecord {
    const probeId = input.probeId ?? newId();
    this.db
      .prepare(
        `INSERT INTO probes (
          probe_id, session_id, client, client_version, observed_level,
          busy_receive, idle_wakeup, evidence_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        probeId,
        input.sessionId,
        input.client,
        input.clientVersion ?? null,
        input.observedLevel,
        input.busyReceive === null || input.busyReceive === undefined
          ? null
          : Number(input.busyReceive),
        input.idleWakeup === null || input.idleWakeup === undefined
          ? null
          : Number(input.idleWakeup),
        input.evidenceJson ?? null,
        input.observedAt,
      );
    return this.get(probeId) as ProbeRecord;
  }

  get(probeId: string): ProbeRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM probes WHERE probe_id = ?")
      .get(probeId) as Row | undefined;
    return row === undefined ? undefined : probeFromRow(row);
  }

  latestForSession(sessionId: string): ProbeRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM probes
         WHERE session_id = ?
         ORDER BY observed_at DESC, probe_id DESC
         LIMIT 1`,
      )
      .get(sessionId) as Row | undefined;
    return row === undefined ? undefined : probeFromRow(row);
  }
}
