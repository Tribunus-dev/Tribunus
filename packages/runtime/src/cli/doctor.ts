import { effectCmd } from "./effect-cmd"
import { Effect } from "effect"
import { UI } from "./ui"
import { exec } from "node:child_process"
import { promisify } from "node:util"

const execAsync = promisify(exec)

export const DoctorCommand = effectCmd({
  command: "doctor",
  describe: "Check system health, GPU drivers, and compatibility",
  instance: false,
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      describe: "Output in JSON format",
    }),
  handler: (args) =>
    Effect.gen(function* () {
      const results: Record<string, { status: "✅" | "❌" | "⚠️"; message: string }> = {}

      const checkCommand = async (name: string, cmd: string, successMsg: string, failMsg: string) => {
        try {
          await execAsync(cmd)
          results[name] = { status: "✅", message: successMsg }
        } catch {
          results[name] = { status: "❌", message: failMsg }
        }
      }

      await checkCommand("nvidia", "nvidia-smi", "NVIDIA drivers found", "NVIDIA drivers missing")
      await checkCommand("vulkan", "vulkaninfo --summary", "Vulkan found", "Vulkan missing")
      
      if (process.platform === "darwin") {
        await checkCommand("metal", "system_profiler SPDisplaysDataType | grep Metal", "Metal found", "Metal missing")
      } else {
        results["metal"] = { status: "⚠️", message: "Metal not applicable on this OS" }
      }

      await checkCommand("rocm", "rocminfo", "ROCm found", "ROCm missing")

      try {
        const { stdout } = await execAsync("df -k .")
        const lines = stdout.trim().split("\n")
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/)
          const avail = parseInt(parts[3], 10)
          if (avail < 10 * 1024 * 1024) { // less than 10GB
             results["disk"] = { status: "⚠️", message: "Low disk space (< 10GB)" }
          } else {
             results["disk"] = { status: "✅", message: "Adequate disk space" }
          }
        }
      } catch {
         results["disk"] = { status: "❌", message: "Could not check disk space" }
      }

      if (args.json) {
        console.log(JSON.stringify(results, null, 2))
      } else {
        UI.println(UI.Style.TEXT_INFO_BOLD + "Tribunus Doctor Report:" + UI.Style.TEXT_NORMAL)
        for (const [key, result] of Object.entries(results)) {
          UI.println(`${result.status} ${key}: ${result.message}`)
        }
      }
    }) as any,
})
