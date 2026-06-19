import { loadConfig, generateDefaultConfig } from "./server/config"
  .scriptName("tribunus")
  .command("init", "Initialize tribunus.jsonc configuration", {}, async () => {
    generateDefaultConfig()
  })
  .command(
    "server",
    "Start the Tribunus server",
    (yargs) => {
      return yargs
        .option("port", { type: "number", describe: "Port to listen on" })
        .option("model", { type: "string", describe: "Default model to use" })
        .option("verbose", { type: "boolean", describe: "Print verbose output including effective config" })
    },
    async (argv) => {
      const cliOverrides: any = {}
      if (argv.port !== undefined) cliOverrides.server = { port: argv.port }
      if (argv.model !== undefined) cliOverrides.model = { default: argv.model }
      
      const config = loadConfig(cliOverrides)
      if (argv.verbose) {
        console.log("Effective config:", JSON.stringify(config, null, 2))
      }
      
      // The server startup will be initialized here
    }
  )

cli.parse()
