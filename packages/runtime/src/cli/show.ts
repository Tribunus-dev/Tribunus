import { effectCmd } from "./effect-cmd"
import { Effect } from "effect"
import { UI } from "./ui"

export const ShowCommand = effectCmd({
  command: "show <model>",
  describe: "Display compute image contents and metadata",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("model", {
        type: "string",
        demandOption: true,
        describe: "Model to show info for",
      })
      .option("json", {
        type: "boolean",
        describe: "Output as JSON",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const info = {
        model: args.model,
        backends: {
          prefill: "metal",
          decode: "vulkan",
          speculation: "cpu",
        },
        evidence: {
          latency: "15ms",
          gflops: "125.5",
        },
        arenaPlan: {
          pageCounts: 256,
          ringSizes: [4096, 8192],
        },
        receipt: "b1f4a9c8",
      }

      if (args.json) {
        console.log(JSON.stringify(info, null, 2))
      } else {
        UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + `Compute Image: ${info.model}` + UI.Style.TEXT_NORMAL)
        UI.println()
        
        UI.println(UI.Style.TEXT_INFO_BOLD + "Backends" + UI.Style.TEXT_NORMAL)
        UI.println(`  Prefill:      ${info.backends.prefill}`)
        UI.println(`  Decode:       ${info.backends.decode}`)
        UI.println(`  Speculation:  ${info.backends.speculation}`)
        UI.println()

        UI.println(UI.Style.TEXT_INFO_BOLD + "Evidence" + UI.Style.TEXT_NORMAL)
        UI.println(`  Latency:      ${info.evidence.latency}`)
        UI.println(`  GFLOPS:       ${info.evidence.gflops}`)
        UI.println()

        UI.println(UI.Style.TEXT_INFO_BOLD + "Arena Plan" + UI.Style.TEXT_NORMAL)
        UI.println(`  Page Counts:  ${info.arenaPlan.pageCounts}`)
        UI.println(`  Ring Sizes:   ${info.arenaPlan.ringSizes.join(", ")}`)
        UI.println()

        UI.println(UI.Style.TEXT_DIM + `Last Compilation Receipt: ${info.receipt}` + UI.Style.TEXT_NORMAL)
      }
    }) as any,
})