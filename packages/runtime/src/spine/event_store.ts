import { PGlite } from '@electric-sql/pglite';
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { ulid } from 'ulid';

export interface SpineEvent {
  event_id: string;
  aggregate_id: string;
  event_type: string;
  payload: any;
  timestamp: string;
  sequence_number: number;
}

export class EventStore {
  private db: PGlite;
  private backupPath: string;
  private currentSequence: number = 0;

  constructor(dbPath?: string) {
    const spineDir = join(homedir(), '.tribunus', 'spine');
    const pglitePath = dbPath || join(spineDir, 'event_store');
    this.db = new PGlite(pglitePath);
    this.backupPath = join(spineDir, 'events.jsonl');
  }

  async init() {
    const spineDir = join(homedir(), '.tribunus', 'spine');
    await mkdir(spineDir, { recursive: true });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        sequence_number SERIAL PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);
    
    const result = await this.db.query('SELECT MAX(sequence_number) as max_seq FROM events;');
    if (result.rows.length > 0 && result.rows[0].max_seq !== null) {
      this.currentSequence = Number(result.rows[0].max_seq);
    }
  }

  async close() {
    await this.db.close();
  }

  async append(aggregate_id: string, event_type: string, payload: any): Promise<SpineEvent> {
    this.currentSequence++;
    const event: SpineEvent = {
      event_id: ulid(),
      aggregate_id,
      event_type,
      payload,
      timestamp: new Date().toISOString(),
      sequence_number: this.currentSequence,
    };

    await this.db.query(
      'INSERT INTO events (sequence_number, event_id, aggregate_id, event_type, payload, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
      [event.sequence_number, event.event_id, event.aggregate_id, event.event_type, JSON.stringify(event.payload), event.timestamp]
    );

    await appendFile(this.backupPath, JSON.stringify(event) + '\n');

    return event;
  }

  async getEventsSince(sequence_number: number): Promise<SpineEvent[]> {
    const result = await this.db.query(
      'SELECT * FROM events WHERE sequence_number > $1 ORDER BY sequence_number ASC',
      [sequence_number]
    );
    return result.rows as unknown as SpineEvent[];
  }

  async getAllEvents(): Promise<SpineEvent[]> {
    const result = await this.db.query('SELECT * FROM events ORDER BY sequence_number ASC');
    return result.rows as unknown as SpineEvent[];
  }
  
  async getReceiptEvents(): Promise<SpineEvent[]> {
    const result = await this.db.query('SELECT * FROM events WHERE event_type LIKE \'%receipt%\' OR event_type = \'emitted\' OR event_type = \'flushed\' ORDER BY sequence_number ASC');
    return result.rows as unknown as SpineEvent[];
  }
}
