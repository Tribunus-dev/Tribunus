import { EventStore } from './event_store';
import type { SpineEvent } from './event_store';
import { HealthProjector } from './projector';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export interface Snapshot {
  last_sequence_number: number;
  timestamp: string;
  state: any;
}

export class SnapshotManager {
  private eventStore: EventStore;
  private projector: HealthProjector;
  private currentSnapshot: Snapshot | null = null;
  private snapshotThreshold: number = 1000;
  private eventsSinceSnapshot: number = 0;
  private snapshotPath: string;

  constructor(eventStore: EventStore, projector: HealthProjector) {
    this.eventStore = eventStore;
    this.projector = projector;
    this.snapshotPath = join(homedir(), '.tribunus', 'spine', 'snapshot.json');
  }

  async loadSnapshot(snapshot: Snapshot) {
    this.currentSnapshot = snapshot;
    // Overwrite projector state via setting the state explicitly.
    // The previous implementation mutated the return of getState which is an object,
    // but the utilization was a primitive that wouldn't update.
    this.projector.setState(snapshot.state);
    
    // Replay events since snapshot
    const events = await this.eventStore.getEventsSince(snapshot.last_sequence_number);
    for (const event of events) {
      this.projector.apply(event);
    }
    this.eventsSinceSnapshot = events.length;
  }
  
  async loadSnapshotFromDisk() {
    try {
      const data = await readFile(this.snapshotPath, 'utf-8');
      const snapshot: Snapshot = JSON.parse(data);
      await this.loadSnapshot(snapshot);
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }
  }

  async handleEvent(event: SpineEvent) {
    this.projector.apply(event);
    this.eventsSinceSnapshot++;

    if (this.eventsSinceSnapshot >= this.snapshotThreshold) {
      await this.takeSnapshot(event.sequence_number);
    }
  }

  async takeSnapshot(sequence_number: number): Promise<Snapshot> {
    const snapshot: Snapshot = {
      last_sequence_number: sequence_number,
      timestamp: new Date().toISOString(),
      state: JSON.parse(JSON.stringify(this.projector.getState())),
    };

    this.currentSnapshot = snapshot;
    this.eventsSinceSnapshot = 0;

    await writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2));

    return snapshot;
  }

  getCurrentSnapshot(): Snapshot | null {
    return this.currentSnapshot;
  }
}
