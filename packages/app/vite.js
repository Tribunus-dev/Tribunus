import { readFileSync } from "node:fs"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/tribunus-theme-preload.js", import.meta.url))

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        define: {
          "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
          "import.meta.env.VITE_WEBCONTAINER_ISOLATION": JSON.stringify(process.env.VITE_WEBCONTAINER_ISOLATION ?? "false"),
        },
        worker: {
          format: "es",
        },
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (process.env.VITE_WEBCONTAINER_ISOLATION === "true") {
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
        }
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (process.env.VITE_WEBCONTAINER_ISOLATION === "true") {
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
        }
        next()
      })
    },
  },
  {
    name: "tribunus-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="tribunus-theme-preload-script" src="/tribunus-theme-preload.js"></script>',
        `<script id="tribunus-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  tailwindcss(),
  solidPlugin(),
]
