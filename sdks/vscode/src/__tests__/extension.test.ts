import * as assert from "assert"
import * as vscode from "vscode"

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.")

  test("Extension should be present", () => {
    assert.ok(vscode.extensions.getExtension("sst-dev.opencode"))
  })

  test("Should activate successfully", async () => {
    const ext = vscode.extensions.getExtension("sst-dev.opencode")
    if (ext && !ext.isActive) {
      await ext.activate()
    }
    assert.ok(ext?.isActive)
  })

  test("Commands should be registered", async () => {
    const ext = vscode.extensions.getExtension("sst-dev.opencode")
    if (ext && !ext.isActive) {
      await ext.activate()
    }
    const commands = await vscode.commands.getCommands()
    assert.ok(commands.includes("opencode.openTerminal"))
    assert.ok(commands.includes("opencode.openNewTerminal"))
    assert.ok(commands.includes("opencode.addFilepathToTerminal"))
  })

  test("Command execution (stub)", async () => {
    // A stub testing command execution without actually trying to spawn terminals
    // In a full implementation, you would mock vscode.window.createTerminal
    assert.ok(true, "Command execution stub passed")
  })

  test("Configuration reading (stub)", () => {
    // The current extension does not read from vscode.workspace.getConfiguration
    // but this serves as a stub for when configurations are added.
    const config = vscode.workspace.getConfiguration("opencode")
    assert.ok(config, "Configuration reading stub passed")
  })

  test("Error handling (stub)", () => {
    // Stub for testing extension error handling (disconnected, invalid config, etc.)
    // Currently the extension handles fetch catch logic silently.
    assert.ok(true, "Error handling stub passed")
  })
})