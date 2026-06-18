const fs = require('fs')

let content = fs.readFileSync('packages/runtime/src/coordination/valkey-fabric.ts', 'utf8')

const target = `
    async enqueue(queue: string, job: CoordinationJob): Promise<void> {
      await redis.xadd(\`queue_stream:\${queue}\`, "*", "payload", JSON.stringify(job))
    },

    async dequeue(queue: string): Promise<CoordinationJob | undefined> {
      try {
        await redis.xgroup("CREATE", \`queue_stream:\${queue}\`, "workers", "$", "MKSTREAM")
      } catch (err: any) {
        if (!err.message.includes("BUSYGROUP")) throw err
      }

      // XREADGROUP returns an array like: [ [ 'stream_name', [ [ 'entry_id', [ 'key', 'value' ] ] ] ] ]
      const result = await redis.xreadgroup(
        "GROUP", "workers", "consumer",
        "COUNT", 1,
        "STREAMS", \`queue_stream:\${queue}\`, ">"
      ) as any

      if (!result || result.length === 0) return undefined

      const entries = result[0][1]
      if (!entries || entries.length === 0) return undefined

      const entry = entries[0]
      const entryId = entry[0]
      const fields = entry[1]

      let payload = ""
      for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] === "payload") {
          payload = fields[i + 1]
          break
        }
      }

      if (!payload) return undefined

      await redis.xack(\`queue_stream:\${queue}\`, "workers", entryId)

      return JSON.parse(payload) as CoordinationJob
    },

    async backpressure(queue: string): Promise<BackpressureState> {
      const len = await redis.xlen(\`queue_stream:\${queue}\`)
      return { queued: len, processing: 0, throttled: len > 100 }
    },`

const regex = /async enqueue\(queue: string, job: CoordinationJob\): Promise<void> \{[\s\S]*?async backpressure\(queue: string\): Promise<BackpressureState> \{[\s\S]*?return \{ queued: len, processing: 0, throttled: len > 100 \}\n    \},/m;

content = content.replace(regex, target);

fs.writeFileSync('packages/runtime/src/coordination/valkey-fabric.ts', content);
