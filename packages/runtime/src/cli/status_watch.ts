import * as blessed from "blessed"

export function startWatchDashboard() {
  return new Promise<void>((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: "Tribunus ps",
    })
    
    screen.key(["escape", "q", "C-c"], () => {
      return process.exit(0)
    })

    const table = blessed.table({
      top: 0,
      left: 0,
      width: "100%",
      height: "50%",
      align: "left",
      border: { type: "line" },
      style: {
        header: { fg: "blue", bold: true },
        cell: { fg: "white" }
      }
    })
    
    const requestsBox = blessed.box({
      top: "50%",
      left: 0,
      width: "50%",
      height: "50%",
      label: "Active Requests",
      border: { type: "line" },
      tags: true,
    })
    
    const sparklineBox = blessed.box({
      top: "50%",
      left: "50%",
      width: "50%",
      height: "50%",
      label: "Token Rate",
      border: { type: "line" },
    })

    screen.append(table)
    screen.append(requestsBox)
    screen.append(sparklineBox)

    const update = () => {
      // Provide parsed tags for colors
      table.setData([
        ["MODEL", "BACKEND", "VRAM", "ACTIVE", "UPTIME", "TOK/S"],
        ["llama-3-8b", "metal", "6.2 GB", "{yellow-fg}prefill{/}", "02:15:30", "45"],
        ["mistral-7b", "vulkan", "5.1 GB", "{green-fg}decode{/}", "01:00:10", "30"],
        ["mixtral-8x7b", "cpu", "24.0 GB", "{cyan-fg}speculation{/}", "05:10:00", "15"],
        ["phi-3-mini", "metal", "1.8 GB", "{gray-fg}idle{/}", "00:30:00", "0"],
      ])
      
      requestsBox.setContent("ID: req-1 | Phase: {yellow-fg}prefill{/} | Elapsed: 2.5s\nID: req-2 | Phase: {green-fg}decode{/} | Elapsed: 10.1s")
      
      // basic sparkline mock using blocks
      sparklineBox.setContent(" ▃▄▅▆▇█▇▆▅▄▃ ")
      
      screen.render()
    }

    // Enable tags parsing for the table too
    table.setContent = function() {
       return this.setContent("")
    }

    update()
    const interval = setInterval(update, 1000)

    screen.on("destroy", () => {
      clearInterval(interval)
      resolve()
    })
  })
}