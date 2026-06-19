import { effectCmd } from "./effect-cmd"
import { Effect } from "effect"
import { UI } from "./ui"
import { startWatchDashboard } from "./status_watch"

export const PsCommand = effectCmd({
  command: "ps",
  describe: "List running models and backends",
  instance: false,
  builder: (yargs) =>
    yargs.option("watch", {
      type: "boolean",
      describe: "Live terminal dashboard",
    }),
  handler: (args) =>
    Effect.gen(function* () {
      if (args.watch) {
        yield* Effect.promise(() => startWatchDashboard())
      } else {
        UI.println(UI.Style.TEXT_INFO_BOLD + "MODEL\t\tBACKEND\tVRAM\tACTIVE\tUPTIME\tTOK/S" + UI.Style.TEXT_NORMAL)
        UI.println("llama-3-8b\tmetal\t6.2 GB\t1\t02:15:30\t45")
        UI.println("mistral-7b\tvulkan\t5.1 GB\t2\t01:00:10\t30")
      }
    }) as any,
})