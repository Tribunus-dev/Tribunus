import { SpineEvent } from './event_store';

export interface ModelProjectorState {
  models: {
    [aggregate_id: string]: {
      status: 'loaded' | 'unloaded' | 'evicted';
      vram_usage: number;
      uptime_start: number | null;
      tokens_generated: number;
    }
  };
}

export class ModelProjector {
  state: ModelProjectorState = { models: {} };

  apply(event: SpineEvent) {
    if (!this.state.models[event.aggregate_id] && event.event_type.startsWith('model_')) {
      this.state.models[event.aggregate_id] = {
        status: 'unloaded',
        vram_usage: 0,
        uptime_start: null,
        tokens_generated: 0,
      };
    }
    
    // Also initialize model state if we see a request event with a model_id we don't know about
    if (event.event_type.startsWith('request_') && event.payload.model_id && !this.state.models[event.payload.model_id]) {
      this.state.models[event.payload.model_id] = {
        status: 'unloaded', // assume unloaded or we don't know
        vram_usage: 0,
        uptime_start: null,
        tokens_generated: 0,
      };
    }

    const model = this.state.models[event.aggregate_id];

    if (model) {
      switch (event.event_type) {
        case 'model_loaded':
          model.status = 'loaded';
          model.vram_usage = event.payload.vram_usage || 0;
          model.uptime_start = Date.parse(event.timestamp);
          break;
        case 'model_unloaded':
          model.status = 'unloaded';
          model.vram_usage = 0;
          model.uptime_start = null;
          break;
        case 'model_evicted':
          model.status = 'evicted';
          model.vram_usage = 0;
          model.uptime_start = null;
          break;
      }
    }

    if (event.event_type === 'request_decoded' && event.payload.model_id) {
       const modelState = this.state.models[event.payload.model_id];
       if (modelState) {
           modelState.tokens_generated += (event.payload.tokens_generated || 0);
       }
    }
  }
}

export interface RequestProjectorState {
  requests: {
    [aggregate_id: string]: {
      status: 'received' | 'prefilling' | 'decoding' | 'completed' | 'failed';
      latency_ms?: number;
      start_time: number;
      model_id: string;
    }
  };
}

export class RequestProjector {
  state: RequestProjectorState = { requests: {} };

  apply(event: SpineEvent) {
    if (!this.state.requests[event.aggregate_id] && event.event_type.startsWith('request_')) {
      this.state.requests[event.aggregate_id] = {
        status: 'received',
        start_time: Date.parse(event.timestamp),
        model_id: event.payload.model_id || '',
      };
    }

    const req = this.state.requests[event.aggregate_id];
    if (!req) return;

    switch (event.event_type) {
      case 'request_received':
        req.status = 'received';
        break;
      case 'request_prefilling':
        req.status = 'prefilling';
        break;
      case 'request_decoding':
        req.status = 'decoding';
        break;
      case 'request_completed':
        req.status = 'completed';
        req.latency_ms = Date.parse(event.timestamp) - req.start_time;
        break;
      case 'request_failed':
        req.status = 'failed';
        break;
    }
  }
}

export interface LeaseProjectorState {
  leases: {
    [aggregate_id: string]: {
      status: 'acquired' | 'released' | 'timed_out';
      page_id: string;
    }
  };
  utilization: number;
}

export class LeaseProjector {
  state: LeaseProjectorState = { leases: {}, utilization: 0 };

  apply(event: SpineEvent) {
    if (!this.state.leases[event.aggregate_id] && event.event_type.startsWith('lease_')) {
      this.state.leases[event.aggregate_id] = {
        status: 'acquired',
        page_id: event.payload.page_id || '',
      };
    }

    const lease = this.state.leases[event.aggregate_id];
    if (!lease) return;

    switch (event.event_type) {
      case 'lease_acquired':
        lease.status = 'acquired';
        this.state.utilization++;
        break;
      case 'lease_released':
        if (lease.status === 'acquired') this.state.utilization--;
        lease.status = 'released';
        break;
      case 'lease_timed_out':
        if (lease.status === 'acquired') this.state.utilization--;
        lease.status = 'timed_out';
        break;
    }
  }
}

export class HealthProjector {
  public modelProjector = new ModelProjector();
  public requestProjector = new RequestProjector();
  public leaseProjector = new LeaseProjector();

  apply(event: SpineEvent) {
    this.modelProjector.apply(event);
    this.requestProjector.apply(event);
    this.leaseProjector.apply(event);
  }

  getState() {
    return {
      models: this.modelProjector.state.models,
      requests: this.requestProjector.state.requests,
      leases: this.leaseProjector.state.leases,
      utilization: this.leaseProjector.state.utilization,
    };
  }

  setState(state: any) {
    this.modelProjector.state.models = state.models;
    this.requestProjector.state.requests = state.requests;
    this.leaseProjector.state.leases = state.leases;
    this.leaseProjector.state.utilization = state.utilization;
  }
}
