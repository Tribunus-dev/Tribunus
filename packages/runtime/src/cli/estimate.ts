import { effectCmd } from "./effect-cmd"
import { Effect } from "effect"
import { UI } from "./ui"

export const EstimateCommand = effectCmd({
  command: "estimate <model>",
  describe: "Estimate VRAM for model at each quantization",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("model", {
        type: "string",
        demandOption: true,
        describe: "Model to estimate",
      })
      .option("json", {
        type: "boolean",
        describe: "Output in JSON format",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      // Mock logic for VRAM estimation
      const model = args.model as string
      const estimates = [
        { quant: "q4_k_m", vram: 4.5, recommended: true, fit: true },
        { quant: "q8_0", vram: 8.2, recommended: false, fit: true },
        { quant: "fp16", vram: 16.0, recommended: false, fit: false }
      ]

      if (args.json) {
        console.log(JSON.stringify({ model, estimates }, null, 2))
      } else {
        UI.println(UI.Style.TEXT_INFO_BOLD + `VRAM Estimates for ${model}:` + UI.Style.TEXT_NORMAL)
        for (const est of estimates) {
          const status = est.fit ? (est.recommended ? "✅ (Recommended)" : "✅") : "❌ (Won't fit)"
          UI.println(`- ${est.quant}: ${est.vram} GB ${status}`)
        }
        if (estimates.some(e => !e.fit)) {
           UI.println(UI.Style.TEXT_WARNING + "\nWarning: Some quantizations won't fit in available VRAM." + UI.Style.TEXT_NORMAL)
        }
      }
    }) as any,
})
