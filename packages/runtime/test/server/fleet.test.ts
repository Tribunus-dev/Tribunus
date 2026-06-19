import { test, expect } from "bun:test";
import { FleetManager, type NodeInfo } from "../../src/server/fleet";

test("FleetManager: route request to node with model", () => {
  const fleet = new FleetManager();

  const nodeA: NodeInfo = { id: "node-a", available: true, models: ["gpt-4", "llama-3"], load: 10 };
  const nodeB: NodeInfo = { id: "node-b", available: true, models: ["gpt-4"], load: 5 };
  const nodeC: NodeInfo = { id: "node-c", available: true, models: [], load: 1 };

  fleet.registerNode(nodeA);
  fleet.registerNode(nodeB);
  fleet.registerNode(nodeC);

  // gpt-4 is on A and B, B has lower load
  const target = fleet.routeRequest("gpt-4");
  expect(target).toBe("node-b");
  
  // llama-3 is only on A
  const targetLlama = fleet.routeRequest("llama-3");
  expect(targetLlama).toBe("node-a");

  const receipt = fleet.getReceipt();
  expect(receipt.requests_routed).toBe(2);
  expect(receipt.fallback_count).toBe(0);
});

test("FleetManager: fallback to compilation path if model not available", () => {
  const fleet = new FleetManager();

  const nodeA: NodeInfo = { id: "node-a", available: true, models: ["gpt-4"], load: 10 };
  fleet.registerNode(nodeA);

  const target = fleet.routeRequest("gpt-4");
  expect(target).toBe("node-a");

  // Unload model on node A
  fleet.updateNodeModels("node-a", []);

  // Route request again, should fallback
  const fallbackTarget = fleet.routeRequest("gpt-4");
  expect(fallbackTarget).toBeNull();

  const receipt = fleet.getReceipt();
  expect(receipt.requests_routed).toBe(2); // One successful, one fallback (it was requested)
  expect(receipt.fallback_count).toBe(1);
  expect(receipt.models_loaded).toBe(0);
});
