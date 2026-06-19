export interface NodeInfo {
  id: string;
  available: boolean;
  models: string[];
  load: number;
}

export interface DatacenterReceipt {
  fleet_size: number;
  nodes_available: number;
  models_loaded: number;
  requests_routed: number;
  avg_routing_latency_us: number;
  fallback_count: number;
}

export class FleetManager {
  private nodes: Map<string, NodeInfo> = new Map();
  private stats: DatacenterReceipt = {
    fleet_size: 0,
    nodes_available: 0,
    models_loaded: 0,
    requests_routed: 0,
    avg_routing_latency_us: 0,
    fallback_count: 0,
  };

  public registerNode(node: NodeInfo): void {
    this.nodes.set(node.id, node);
    this.updateStats();
  }

  public updateNodeModels(nodeId: string, models: string[]): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.models = models;
      this.updateStats();
    }
  }

  private updateStats(): void {
    this.stats.fleet_size = this.nodes.size;
    let availableCount = 0;
    let totalModelsLoaded = 0;

    for (const node of this.nodes.values()) {
      if (node.available) availableCount++;
      totalModelsLoaded += node.models.length;
    }

    this.stats.nodes_available = availableCount;
    this.stats.models_loaded = totalModelsLoaded;
  }

  public routeRequest(model: string): string | null {
    const startTime = process.hrtime.bigint();
    
    let bestNode: NodeInfo | null = null;
    let bestLoad = Infinity;

    for (const node of this.nodes.values()) {
      if (node.available && node.models.includes(model)) {
        if (node.load < bestLoad) {
          bestLoad = node.load;
          bestNode = node;
        }
      }
    }

    const endTime = process.hrtime.bigint();
    const latencyUs = Number((endTime - startTime) / 1000n);

    // Update average latency
    const totalLatency = (this.stats.avg_routing_latency_us * this.stats.requests_routed) + latencyUs;
    this.stats.requests_routed++;
    this.stats.avg_routing_latency_us = totalLatency / this.stats.requests_routed;

    if (bestNode) {
      return bestNode.id;
    } else {
      this.stats.fallback_count++;
      // Return null indicating fallback to compilation path is required
      return null;
    }
  }

  public getReceipt(): DatacenterReceipt {
    return { ...this.stats };
  }
}

