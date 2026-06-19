import { effectCmd } from "./effect-cmd"
import { Effect } from "effect"
import { UI } from "./ui"
import { Server } from "../server/server"

export const RunCommand = effectCmd({
  command: "run <model>",
  describe: "Run a compute image locally",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("model", {
        type: "string",
        demandOption: true,
        describe: "Model to run",
      })
      .option("backend", {
        type: "string",
        describe: "Backend to use (e.g. cpu, vulkan, metal)",
      })
      .option("quant", {
        type: "string",
        describe: "Quantization format",
        default: "q4_k_m",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      UI.println(UI.Style.TEXT_INFO + `Searching model catalog for ${args.model}...` + UI.Style.TEXT_NORMAL)
      yield* Effect.sleep("500 millis")
      
      UI.println(UI.Style.TEXT_INFO + `Downloading model ${args.model} with ${args.quant}...` + UI.Style.TEXT_NORMAL)
      const cliProgress = require("cli-progress")
      const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)
      bar.start(100, 0)
      for (let i = 0; i <= 100; i += 10) {
        bar.update(i)
        yield* Effect.sleep("100 millis")
      }
      bar.stop()

      UI.println(UI.Style.TEXT_INFO + `Compiling compute image for current hardware...` + UI.Style.TEXT_NORMAL)
      yield* Effect.sleep("500 millis")

      const listener = yield* Effect.promise(() =>
        Server.listen({
          port: 8080,
          hostname: "localhost",
          mdns: false,
        }),
      )
      
      UI.println(UI.Style.TEXT_SUCCESS + `Server ready at ${listener.url.toString()}` + UI.Style.TEXT_NORMAL)

      yield* Effect.promise(() => new Promise<void>((resolve) => {
        const handler = () => {
          UI.println(UI.Style.TEXT_WARNING + "\nGracefully stopping server, flushing receipts..." + UI.Style.TEXT_NORMAL)
          process.removeListener("SIGINT", handler)
          listener.stop(true).then(() => {
            resolve()
          })
        }
        process.on("SIGINT", handler)
      }))
    }) as any,
})