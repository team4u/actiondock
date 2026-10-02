import { randomUUID } from "node:crypto";
import type { SqliteDriver, SqliteStatement } from "./types";
import type { Clock } from "./clock";
import { safeParseStoredJson } from "./utils";

export class SqliteEventsStore {
  private statementCache = new Map<string, SqliteStatement>();
  private driver: SqliteDriver;
  private packageId: string;
  private clock: Clock;

  constructor(
    driver: SqliteDriver,
    packageId: string,
    clock: Clock
  ) {
    this.driver = driver;
    this.packageId = packageId;
    this.clock = clock;
  }

  private getStatement(sql: string): SqliteStatement {
    let stmt = this.statementCache.get(sql);
    if (!stmt) {
      stmt = this.driver.prepare(sql);
      this.statementCache.set(sql, stmt);
    }
    return stmt;
  }

  appendEvent(eventType: string, payload: unknown): void {
    const stmt = this.getStatement(`
      INSERT INTO events (id, package_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const id = randomUUID();
    const payloadJson = payload !== undefined ? JSON.stringify(payload) : null;
    stmt.run(
      id,
      this.packageId,
      eventType,
      payloadJson,
      this.clock.now().toISOString()
    );
  }

  queryEvents(eventType?: string): any[] {
    const sql = eventType
      ? "SELECT * FROM events WHERE package_id = ? AND event_type = ? ORDER BY created_at ASC"
      : "SELECT * FROM events WHERE package_id = ? ORDER BY created_at ASC";
    const params = eventType ? [this.packageId, eventType] : [this.packageId];
    const stmt = this.getStatement(sql);
    const rows = stmt.all<any>(...params);
    return rows.map((r: any) => ({
      id: r.id,
      packageId: r.package_id,
      eventType: r.event_type,
      payload: safeParseStoredJson(r.payload_json, `events.payload id=${r.id}`),
      createdAt: r.created_at,
    }));
  }

  close(): void {
    this.statementCache.clear();
  }
}
