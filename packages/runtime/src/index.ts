import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { Effect } from "effect"
import { Installation } from "./installation"
import * as Log from "@tribunus/core/util/log"
import { Server } from "./server/server"
import { effectCmd } from "./cli/effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "./cli/network"
import { errorFormat, errorMessage } from "./util/error"
import { Heap } from "./cli/heap"
import { UI } from "./cli/ui"
import { EOL } from "os"

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text)
    return
  }
  process.stderr.write(out)
}

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: errorMessage(e),
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: errorMessage(e),
  })
})

const args = hideBin(process.argv)

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("opencode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"] as const,
  })
  .middleware(async (opts) => {
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    Heap.start()

    Log.Default.info("serve", {
      args: process.argv.slice(2),
    })
  })
  .usage("")
  .command(
    effectCmd({
      command: "serve",
      builder: (yargs) => withNetworkOptions(yargs),
      describe: "starts a headless server",
      instance: false,
      handler: Effect.fn("Cli.serve")(function* (args) {
        const opts = yield* resolveNetworkOptions(args)
        const server = yield* Effect.promise(() => Server.listen(opts))
        console.log(`server listening on http://${server.hostname}:${server.port}`)

        yield* Effect.never
      }),
    }),
  )
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      process.stderr.write(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  Log.Default.error("fatal", {
    error: errorFormat(e),
  })
  process.exitCode = 1
} finally {
  process.exit()
}
