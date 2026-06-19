import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { EventStore } from "../src/spine/event_store";
import { HealthProjector } from "../src/spine/projector";
import { SnapshotManager } from "../src/spine/snapshot";
import { join } from "path";
import { rm } from "fs/promises";
import { homedir } from "os";

describe("Tribunus Runtime Truth Spine", () => {
  let eventStore: EventStore;
  let projector: HealthProjector;
  let snapshotManager: SnapshotManager;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = join(homedir(), '.tribunus', 'spine', 'test_db_' + Date.now() + '_' + Math.random());
    eventStore = new EventStore(testDbPath);
    await eventStore.init();
    projector = new HealthProjector();
    snapshotManager = new SnapshotManager(eventStore, projector);
  });
  
  afterEach(async () => {
     await eventStore.close();
     try { await rm(testDbPath, { recursive: true, force: true }); } catch (e) {}
  });

  test("Model lifecycle events update ModelProjector state appropriately", async () => {
    const modelId = "model-123";

    const evt1 = await eventStore.append(modelId, "model_loaded", { vram_usage: 1024 });
    projector.apply(evt1);
    
    expect(projector.getState().models[modelId].status).toBe("loaded");
    expect(projector.getState().models[modelId].vram_usage).toBe(1024);
    expect(projector.getState().models[modelId].tokens_generated).toBe(0);

    const requestId = "req-456";
    const evt2 = await eventStore.append(requestId, "request_prefilling", { model_id: modelId });
    projector.apply(evt2);

    const evt3 = await eventStore.append(requestId, "request_decoded", { model_id: modelId, tokens_generated: 42 });
    projector.apply(evt3);

    expect(projector.getState().models[modelId].tokens_generated).toBe(42);
  });

  test("Snapshot functionality at 1000 events", async () => {
    const modelId = "model-snapshot";
    
    // 1. Emit 1000 events
    for (let i = 0; i < 1000; i++) {
      const evt = await eventStore.append(modelId, "request_decoded", { model_id: modelId, tokens_generated: 1 });
      await snapshotManager.handleEvent(evt);
    }

    const stateBeforeSnapshot = JSON.parse(JSON.stringify(projector.getState()));
    expect(stateBeforeSnapshot.models[modelId].tokens_generated).toBe(1000);

    const snapshot = snapshotManager.getCurrentSnapshot();
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;

    expect(snapshot.last_sequence_number).toBeGreaterThanOrEqual(1000);
    expect(snapshot.state.models[modelId].tokens_generated).toBe(1000);

    // 2. Emit one more event after snapshot
    const evt1001 = await eventStore.append(modelId, "request_decoded", { model_id: modelId, tokens_generated: 5 });
    await snapshotManager.handleEvent(evt1001);
    
    expect(projector.getState().models[modelId].tokens_generated).toBe(1005);

    // 3. Create fresh projector and load snapshot
    const newProjector = new HealthProjector();
    const newSnapshotManager = new SnapshotManager(eventStore, newProjector);
    await newSnapshotManager.loadSnapshot(snapshot);

    expect(newProjector.getState().models[modelId].tokens_generated).toBe(1005);
  }, 10000);
  
  test("Receipt store functionality", async () => {
     const evt1 = await eventStore.append("r1", "receipt_emitted", { info: "a" });
     const evt2 = await eventStore.append("r2", "flushed", { info: "b" });
     const evt3 = await eventStore.append("r3", "model_loaded", { info: "c" });
     
     const receipts = await eventStore.getReceiptEvents();
     
     const receiptIds = receipts.map(r => r.event_type);
     expect(receiptIds).toContain("receipt_emitted");
     expect(receiptIds).toContain("flushed");
  });
});
