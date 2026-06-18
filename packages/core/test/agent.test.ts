import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@tribunus/core/agent"
import { PluginV2 } from "@tribunus/core/plugin"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.provideMerge(AgentV2.defaultLayer, PluginV2.defaultLayer))

describe("AgentV2.Service", () => {
  describe("get & update", () => {
    it.effect("should create a new agent with default options on update", () =>
      Effect.gen(function* () {
        const agentId = AgentV2.ID.make("test-agent")
        const svc = yield* AgentV2.Service

        yield* svc.update(agentId, (draft) => {
          draft.description = "Test description"
        })

        const agent = yield* svc.get(agentId)
        expect(agent.name).toBe(agentId)
        expect(agent.description).toBe("Test description")
        expect(agent.mode).toBe("all")
        expect(agent.permission).toEqual([])
        expect(agent.options).toBeDefined()
      }),
    )

    it.effect("should update an existing agent", () =>
      Effect.gen(function* () {
        const agentId = AgentV2.ID.make("test-agent")
        const svc = yield* AgentV2.Service

        yield* svc.update(agentId, (draft) => {
          draft.mode = "subagent"
        })
        
        let agent = yield* svc.get(agentId)
        expect(agent.mode).toBe("subagent")

        yield* svc.update(agentId, (draft) => {
          draft.mode = "primary"
        })

        agent = yield* svc.get(agentId)
        expect(agent.mode).toBe("primary")
      }),
    )

    it.effect("should fail with NotFoundError when getting non-existent agent", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const result = yield* Effect.flip(svc.get(AgentV2.ID.make("non-existent")))
        expect(result).toBeInstanceOf(AgentV2.NotFoundError)
        expect(result.agent).toBe(AgentV2.ID.make("non-existent"))
      }),
    )
  })

  describe("list", () => {
    it.effect("should return agents sorted by name", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        yield* svc.update(AgentV2.ID.make("z-agent"), () => {})
        yield* svc.update(AgentV2.ID.make("a-agent"), () => {})
        yield* svc.update(AgentV2.ID.make("m-agent"), () => {})

        const agents = yield* svc.list()
        expect(agents.length).toBe(3)
        expect(agents[0].name).toBe(AgentV2.ID.make("a-agent"))
        expect(agents[1].name).toBe(AgentV2.ID.make("m-agent"))
        expect(agents[2].name).toBe(AgentV2.ID.make("z-agent"))
      }),
    )
  })

  describe("remove", () => {
    it.effect("should remove an agent", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const agentId = AgentV2.ID.make("test-agent")
        yield* svc.update(agentId, () => {})
        
        // Exists
        yield* svc.get(agentId)
        
        yield* svc.remove(agentId)
        
        // No longer exists
        const result = yield* Effect.flip(svc.get(agentId))
        expect(result).toBeInstanceOf(AgentV2.NotFoundError)
      }),
    )

    it.effect("should clear defaultAgent if it is removed", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const agentId = AgentV2.ID.make("test-agent")
        yield* svc.update(agentId, () => {})
        yield* svc.setDefault(agentId)

        expect(yield* svc.defaultAgent()).toBe(agentId)

        yield* svc.remove(agentId)

        const result = yield* Effect.flip(svc.defaultAgent())
        expect(result).toBeInstanceOf(AgentV2.NoDefaultError)
      }),
    )

    it.effect("should do nothing if removing non-existent agent", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        yield* svc.remove(AgentV2.ID.make("non-existent"))
      }),
    )
  })

  describe("defaults", () => {
    it.effect("should set and get default agent", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const agentId = AgentV2.ID.make("test-agent")
        yield* svc.update(agentId, () => {})
        
        yield* svc.setDefault(agentId)
        const def = yield* svc.defaultInfo()
        expect(def.name).toBe(agentId)
        expect(yield* svc.defaultAgent()).toBe(agentId)
      }),
    )

    it.effect("should fail setting default to non-existent agent", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const result = yield* Effect.flip(svc.setDefault(AgentV2.ID.make("non-existent")))
        expect(result).toBeInstanceOf(AgentV2.NotFoundError)
      }),
    )

    it.effect("should fallback to first visible and non-subagent when default is not explicitly set", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        yield* svc.update(AgentV2.ID.make("a-subagent"), (draft) => { draft.mode = "subagent" })
        yield* svc.update(AgentV2.ID.make("b-hidden"), (draft) => { draft.hidden = true })
        yield* svc.update(AgentV2.ID.make("c-visible"), (draft) => { draft.mode = "all" })
        yield* svc.update(AgentV2.ID.make("d-visible"), (draft) => { draft.mode = "primary" })

        const def = yield* svc.defaultInfo()
        // Because a-subagent is subagent, b-hidden is hidden, c-visible is first valid.
        expect(def.name).toBe(AgentV2.ID.make("c-visible"))
      }),
    )

    it.effect("should fail to get default agent if all agents are hidden or subagent", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        yield* svc.update(AgentV2.ID.make("a-subagent"), (draft) => { draft.mode = "subagent" })
        yield* svc.update(AgentV2.ID.make("b-hidden"), (draft) => { draft.hidden = true })

        const result = yield* Effect.flip(svc.defaultInfo())
        expect(result).toBeInstanceOf(AgentV2.NoDefaultError)
      }),
    )

    it.effect("should fail with InvalidDefaultError(missing) if default agent is missing", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const plugin = yield* PluginV2.Service
        
        yield* plugin.add({
          id: PluginV2.ID.make("override-default"),
          effect: Effect.succeed({
            "agent.default": (input) => Effect.sync(() => {
              input.agent = AgentV2.ID.make("missing-agent")
            })
          })
        })

        const result = yield* Effect.flip(svc.defaultInfo())
        expect(result).toBeInstanceOf(AgentV2.InvalidDefaultError)
        expect((result as AgentV2.InvalidDefaultError).reason).toBe("missing")
        expect((result as AgentV2.InvalidDefaultError).agent).toBe(AgentV2.ID.make("missing-agent"))
      }),
    )

    it.effect("should fail with InvalidDefaultError(subagent) if default agent is a subagent", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const agentId = AgentV2.ID.make("subagent")
        yield* svc.update(agentId, (draft) => { draft.mode = "subagent" })
        yield* svc.setDefault(agentId)

        const result = yield* Effect.flip(svc.defaultInfo())
        expect(result).toBeInstanceOf(AgentV2.InvalidDefaultError)
        expect((result as AgentV2.InvalidDefaultError).reason).toBe("subagent")
        expect((result as AgentV2.InvalidDefaultError).agent).toBe(agentId)
      }),
    )

    it.effect("should fail with InvalidDefaultError(hidden) if default agent is hidden", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const agentId = AgentV2.ID.make("hidden-agent")
        yield* svc.update(agentId, (draft) => { draft.hidden = true })
        yield* svc.setDefault(agentId)

        const result = yield* Effect.flip(svc.defaultInfo())
        expect(result).toBeInstanceOf(AgentV2.InvalidDefaultError)
        expect((result as AgentV2.InvalidDefaultError).reason).toBe("hidden")
        expect((result as AgentV2.InvalidDefaultError).agent).toBe(agentId)
      }),
    )
  })

  describe("plugins hooks", () => {
    it.effect("should cancel agent update if plugin hook sets cancel=true", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const plugin = yield* PluginV2.Service
        
        yield* plugin.add({
          id: PluginV2.ID.make("cancel-update"),
          effect: Effect.succeed({
            "agent.update": (input) => Effect.sync(() => {
              input.cancel = true
            })
          })
        })

        const agentId = AgentV2.ID.make("test-agent")
        yield* svc.update(agentId, () => {})

        const result = yield* Effect.flip(svc.get(agentId))
        expect(result).toBeInstanceOf(AgentV2.NotFoundError)
      }),
    )

    it.effect("should apply plugin changes to agent info on update", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const plugin = yield* PluginV2.Service
        
        yield* plugin.add({
          id: PluginV2.ID.make("modify-update"),
          effect: Effect.succeed({
            "agent.update": (input) => Effect.sync(() => {
              input.agent.description = "Plugin modified"
            })
          })
        })

        const agentId = AgentV2.ID.make("test-agent")
        yield* svc.update(agentId, () => {})

        const agent = yield* svc.get(agentId)
        expect(agent.description).toBe("Plugin modified")
      }),
    )

    it.effect("should cancel agent removal if plugin hook sets cancel=true", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const plugin = yield* PluginV2.Service
        
        const agentId = AgentV2.ID.make("test-agent")
        yield* svc.update(agentId, () => {})

        yield* plugin.add({
          id: PluginV2.ID.make("cancel-remove"),
          effect: Effect.succeed({
            "agent.remove": (input) => Effect.sync(() => {
              if (input.agent.name === agentId) {
                input.cancel = true
              }
            })
          })
        })

        yield* svc.remove(agentId)
        
        // Should still exist
        const agent = yield* svc.get(agentId)
        expect(agent.name).toBe(agentId)
      }),
    )

    it.effect("should override default agent using plugin hook", () =>
      Effect.gen(function* () {
        const svc = yield* AgentV2.Service
        const plugin = yield* PluginV2.Service
        
        const agent1 = AgentV2.ID.make("agent1")
        const agent2 = AgentV2.ID.make("agent2")
        yield* svc.update(agent1, () => {})
        yield* svc.update(agent2, () => {})
        yield* svc.setDefault(agent1)

        yield* plugin.add({
          id: PluginV2.ID.make("override-default"),
          effect: Effect.succeed({
            "agent.default": (input) => Effect.sync(() => {
              input.agent = agent2
            })
          })
        })

        const def = yield* svc.defaultInfo()
        expect(def.name).toBe(agent2)
      }),
    )
  })
})
