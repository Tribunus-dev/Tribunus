const fs = require('fs')

let content = fs.readFileSync('packages/runtime/src/control-plane/migrate.ts', 'utf8')

content = content.replace(
  'import { Effect, Layer, Context } from "effect"',
  'import { Effect, Layer, Context } from "effect"\nimport { provideInstanceEffect } from "@/project/instance-context"\nimport { InstanceLayer } from "@/effect/instance-context"\nimport { CrossSpawnSpawner } from "@tribunus/core/spawner"\nimport { NodeFileSystem } from "@effect/platform-node"\nimport { Env } from "@/env"\nimport { Config } from "@/config/config"\nimport { DuckDBConfig } from "@/effect/config-service"'
);

const target = `  console.log("Entity directories configured:")
  for (const [type, dir] of Object.entries(ENTITY_DIRS)) {
    const exists = fs.existsSync(dir)
    const count = exists
      ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length
      : 0
    console.log(\`  \${type}: \${dir} (\${count} files) \${exists ? "" : "[MISSING]"}\`)
  }

  console.log("\\nStarting migration...")

  const program = Effect.gen(function* () {
    const adapter = yield* DatabaseAdapter.Service
    const report = yield* migrateAll(adapter, dryRun)

    console.log(\`\\nMigration completed in \${report.durationMs}ms\`)
    for (const [type, progress] of Object.entries(report.progress)) {
      console.log(\`  \${type}: \${progress.migrated} migrated, \${progress.skipped} skipped, \${progress.failed} failed\`)
    }
  })

  const runnable = program.pipe(
    Effect.provide(DatabaseAdapter.defaultLayer)
  )
  Effect.runPromise(runnable).catch(console.error)`

const regex = /\/\/ TODO: Wire DatabaseAdapter layer and run migration[\s\S]*?    console\.log\(\`  \$\{type\}: \$\{dir\} \(\$\{count\} files\) \$\{exists \? "" : "\[MISSING\]"\}\`\)\n  \}/m;

content = content.replace(regex, target);

fs.writeFileSync('packages/runtime/src/control-plane/migrate.ts', content);
