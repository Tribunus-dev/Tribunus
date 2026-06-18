import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { PromptContextItems } from "../context-items"

describe("PromptContextItems", () => {
  test("renders empty state correctly", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const dispose = render(() => <PromptContextItems 
      items={[]}
      active={() => false}
      openComment={() => {}}
      remove={() => {}}
      t={(k: string) => k}
    />, container)

    expect(container.innerHTML).toBe("") // Empty because of <Show> wrapper
    dispose()
    container.remove()
  })

  test("renders items and handles interactions", () => {
    const items = [
      { key: "1", path: "/test/file1.ts", type: "file" } as any,
      { key: "2", path: "/test/file2.ts", type: "file", selection: () => ({ startLine: 1, endLine: 5 }) } as any,
    ]
    
    let clickedItem: any = null
    let removedItem: any = null
    
    const container = document.createElement("div")
    document.body.appendChild(container)
    const dispose = render(() => <PromptContextItems 
      items={items}
      active={(item: any) => item.key === "2"}
      openComment={(item: any) => { clickedItem = item }}
      remove={(item: any) => { removedItem = item }}
      t={(k: string) => k}
    />, container)
    
    // Test basic rendering
    const renderedItems = container.querySelectorAll(".group")
    expect(renderedItems.length).toBe(2)
    
    // Check selection logic rendering for second item
    const selectionSpan = container.querySelectorAll("span.text-text-weak")
    expect(selectionSpan.length).toBe(1)
    expect(selectionSpan[0].textContent).toBe(":1-5")
    
    // Test click on the first item to open comment
    renderedItems[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(clickedItem).toBe(items[0])
    
    // Test click on remove button
    const removeButtons = container.querySelectorAll("button[aria-label='prompt.context.removeFile']")
    expect(removeButtons.length).toBe(2)
    
    removeButtons[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(removedItem).toBe(items[1])

    dispose()
    container.remove()
  })
})
