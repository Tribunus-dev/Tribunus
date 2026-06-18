import { describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import { IPC } from "../ipc-channels"
import { mock } from "bun:test"

// Mock electron to prevent import errors in the test environment
mock.module("electron", () => {
  return {
    ipcRenderer: {
      invoke: async () => {},
      send: () => {},
      on: () => {},
    },
    ipcMain: {
      handle: () => {},
      on: () => {},
    },
  }
})

// Dynamically import ipc-contract after the mock is set
const { _channelCoverage } = await import("../ipc-contract")

describe("IPC Contract Coverage", () => {
  test("Compile-time coverage constraint is met", () => {
    // If a channel is missing from IpcHandleContract or IpcSendContract,
    // TypeScript will fail to compile because _channelCoverage will be inferred
    // as an error string literal instead of true.
    expect(_channelCoverage).toBe(true)
  })

  test("Every handle channel has a contract entry (runtime check)", () => {
    const contractFilePath = path.join(__dirname, "../ipc-contract.ts")
    const contractSource = fs.readFileSync(contractFilePath, "utf8")

    // Extract the IpcHandleContract interface body
    const handleContractMatch = contractSource.match(/export interface IpcHandleContract\s*\{([\s\S]*?)\n\}/)
    expect(handleContractMatch).not.toBeNull()

    const handleContractBody = handleContractMatch![1]
    
    // Check every registered handle channel
    for (const key of Object.keys(IPC.handle)) {
      // The contract file uses [IPC.handle.KEY_NAME] syntax
      const expectedSyntax = `[IPC.handle.${key}]:`
      expect(handleContractBody).toContain(expectedSyntax)
    }
  })

  test("Every send channel has a contract entry (runtime check)", () => {
    const contractFilePath = path.join(__dirname, "../ipc-contract.ts")
    const contractSource = fs.readFileSync(contractFilePath, "utf8")

    // Extract the IpcSendContract interface body
    const sendContractMatch = contractSource.match(/export interface IpcSendContract\s*\{([\s\S]*?)\n\}/)
    expect(sendContractMatch).not.toBeNull()

    const sendContractBody = sendContractMatch![1]
    
    // Check every registered send channel
    for (const key of Object.keys(IPC.send)) {
      // The contract file uses [IPC.send.KEY_NAME] syntax
      const expectedSyntax = `[IPC.send.${key}]:`
      expect(sendContractBody).toContain(expectedSyntax)
    }
  })

  test("Channel names follow the 'tribunus:' prefix convention", () => {
    // Check handle channels
    for (const [key, value] of Object.entries(IPC.handle)) {
      expect(value).toMatch(/^tribunus:/)
    }

    // Check send channels
    for (const [key, value] of Object.entries(IPC.send)) {
      expect(value).toMatch(/^tribunus:/)
    }

    // Check push channels
    for (const [key, value] of Object.entries(IPC.push)) {
      expect(value).toMatch(/^tribunus:/)
    }
  })

  test("No duplicate channel name strings exist", () => {
    const allValues = [
      ...Object.values(IPC.handle),
      ...Object.values(IPC.send),
      ...Object.values(IPC.push),
      ...Object.values(IPC.store)
    ]

    const uniqueValues = new Set(allValues)

    // If size differs, there are duplicates. Let's find them to show a helpful error.
    if (allValues.length !== uniqueValues.size) {
      const seen = new Set<string>()
      const duplicates = new Set<string>()
      for (const val of allValues) {
        if (seen.has(val)) {
          duplicates.add(val)
        }
        seen.add(val)
      }
      throw new Error(`Found duplicate IPC channel strings: ${Array.from(duplicates).join(", ")}`)
    }

    expect(allValues.length).toBe(uniqueValues.size)
  })
})
