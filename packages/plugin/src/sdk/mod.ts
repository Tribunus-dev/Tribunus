import { type z } from "zod"
import { type PluginManifest, validateManifest } from "./manifest.js"
import { PermissionManager, PermissionError, ScopedFS } from "./permissions.js"

export interface ToolDefinition<Args extends z.ZodRawShape = any> {
  name: string
  schema: z.ZodObject<Args>
  handler: (args: z.infer<z.ZodObject<Args>>, context: any) => Promise<any>
}

export function createTool<Args extends z.ZodRawShape>(
  name: string,
  schema: z.ZodObject<Args>,
  handler: (args: z.infer<z.ZodObject<Args>>, context: any) => Promise<any>
): ToolDefinition<Args> {
  return { name, schema, handler }
}

export interface AgentDefinition {
  model: string
  tools?: ToolDefinition[]
  systemPrompt?: string
}

export function createAgent(config: AgentDefinition): AgentDefinition {
  return config
}

export interface WorkflowStep {
  name: string
  action: (context: any) => Promise<any>
}

export interface WorkflowDefinition {
  steps: WorkflowStep[]
}

export function createWorkflow(steps: WorkflowStep[]): WorkflowDefinition {
  return { steps }
}

export type PluginLifecycleState = "created" | "loaded" | "activated" | "deactivated"

export class PluginContext {
  private state: PluginLifecycleState = "created"
  private tools: Map<string, ToolDefinition> = new Map()
  private agents: Map<string, AgentDefinition> = new Map()
  private workflows: Map<string, WorkflowDefinition> = new Map()
  
  public permissions: PermissionManager = new PermissionManager()
  public fs: ScopedFS | null = null
  public manifest: PluginManifest | null = null

  constructor(private workingDirectory: string) {}

  async load(packageJson: unknown) {
    if (this.state !== "created" && this.state !== "deactivated") {
      throw new Error(`Cannot load plugin in state: ${this.state}`)
    }
    this.manifest = validateManifest(packageJson)
    this.permissions.load(this.manifest)
    
    // Set up scoped FS (chroot-like)
    let allowedPaths = this.manifest.permissions?.filesystem || []
    this.fs = new ScopedFS(this.workingDirectory, allowedPaths)

    this.state = "loaded"
  }

  registerTool(tool: ToolDefinition) {
    if (this.state !== "loaded" && this.state !== "activated") {
      throw new Error("Cannot register tools unless loaded")
    }
    // Manifest validation: Ensure tool is listed in manifest
    if (this.manifest?.tools && !this.manifest.tools.includes(tool.name)) {
        // Warning: This implies manifest strictly defines tool names.
        // We'll enforce it here if tools are defined.
        throw new PermissionError(`Tool ${tool.name} not declared in manifest`)
    }
    this.tools.set(tool.name, tool)
  }

  registerAgent(name: string, agent: AgentDefinition) {
     this.agents.set(name, agent)
  }

  registerWorkflow(name: string, workflow: WorkflowDefinition) {
     this.workflows.set(name, workflow)
  }

  activate() {
    if (this.state !== "loaded" && this.state !== "deactivated") {
      throw new Error(`Cannot activate plugin in state: ${this.state}`)
    }
    // Require user approval before full activation
    this.permissions.approve()
    
    // Process chdir equivalent (conceptual, we rely on ScopedFS in reality to avoid affecting whole process)
    // process.chdir(this.workingDirectory) - Not safe in a shared node process, ScopedFS is safer
    
    this.state = "activated"
  }

  async runTool(name: string, args: any) {
    if (this.state !== "activated") {
      throw new Error(`Cannot run tool in state: ${this.state}`)
    }
    
    // Check baseline permissions are approved
    this.permissions.checkApproved()

    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool not found: ${name}`)
    }

    const parsedArgs = tool.schema.parse(args)
    return tool.handler(parsedArgs, {
        fs: this.fs,
        permissions: this.permissions,
        // context...
    })
  }

  deactivate() {
    this.state = "deactivated"
  }

  unload() {
    this.state = "created"
    this.tools.clear()
    this.agents.clear()
    this.workflows.clear()
    this.manifest = null
    this.fs = null
  }
}
