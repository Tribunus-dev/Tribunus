import { Context } from "effect"
import type { Redis } from "ioredis"

export class ValkeyRedis extends Context.Service<ValkeyRedis, { readonly client: Redis }>()(
  "@tribunus/ValkeyRedis"
) {}
