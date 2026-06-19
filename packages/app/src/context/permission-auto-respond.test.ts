import { describe, expect, test } from "bun:test"
import { autoRespondsPermission, acceptKey, directoryAcceptKey, isDirectoryAutoAccepting } from "./permission-auto-respond"

describe("permission auto respond rules", () => {
  test("acceptKey", () => {
    expect(acceptKey("session-1")).toBe("session-1")
    expect(acceptKey("session-1", "/fake/dir")).toBe("L2Zha2UvZGly/session-1")
  })

  test("directoryAcceptKey", () => {
    expect(directoryAcceptKey("/fake/dir")).toBe("L2Zha2UvZGly/*")
  })

  test("isDirectoryAutoAccepting", () => {
    expect(isDirectoryAutoAccepting({}, "/fake/dir")).toBe(false)
    expect(isDirectoryAutoAccepting({ "L2Zha2UvZGly/*": true }, "/fake/dir")).toBe(true)
  })

  test("autoRespondsPermission evaluates lineage", () => {
    const session = [
      { id: "root" },
      { id: "child", parentID: "root" },
      { id: "grandchild", parentID: "child" },
    ]
    
    // Explicit deny on child
    expect(autoRespondsPermission({ "child": false }, session, { sessionID: "grandchild" })).toBe(false)
    
    // Explicit allow on root
    expect(autoRespondsPermission({ "root": true }, session, { sessionID: "grandchild" })).toBe(true)
    
    // Nearest takes precedence (child over root)
    expect(autoRespondsPermission({ "child": false, "root": true }, session, { sessionID: "grandchild" })).toBe(false)
    expect(autoRespondsPermission({ "child": true, "root": false }, session, { sessionID: "grandchild" })).toBe(true)
  })

  test("autoRespondsPermission with directory keys", () => {
    const session = [{ id: "session-1" }]
    
    // No match
    expect(autoRespondsPermission({}, session, { sessionID: "session-1" }, "/fake/dir")).toBe(false)
    
    // Directory level fallback
    expect(autoRespondsPermission({ "L2Zha2UvZGly/*": true }, session, { sessionID: "session-1" }, "/fake/dir")).toBe(true)
    
    // Specific session/directory combo takes precedence
    expect(autoRespondsPermission({ 
      "L2Zha2UvZGly/session-1": false, 
      "L2Zha2UvZGly/*": true 
    }, session, { sessionID: "session-1" }, "/fake/dir")).toBe(false)
  })
})
