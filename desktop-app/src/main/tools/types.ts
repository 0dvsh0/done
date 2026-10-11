import type { SpanKind } from '../../shared/types'

/* ==========================================================================
   The tool contract.

   A tool is something the agent can actually do. It has a name the model
   chooses, a schema describing its arguments, and a `run` that performs the
   real work. What comes back is what lands in the trace — there is no
   separate, prettier version of the result kept for the UI.

   `irreversible: true` is the hard rule the product is built on. Those tools
   never run without the user saying yes, whatever the spending limit says.
   ========================================================================== */

export interface ToolResult {
  ok: boolean
  /** One short line. This is what the trace row and the receipt read. */
  output: string
  /** The full payload handed to the model for its next decision. */
  data: unknown
  /** Present when the content was screened by the injection classifier. */
  guard?: { safe: boolean; score: number; reason: string }
}

export interface ToolContext {
  signal: AbortSignal
  /** True when the run is being torn down — long work should bail early. */
  readonly aborted: boolean
}

export interface ToolJsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export interface Tool {
  name: string
  kind: SpanKind
  /** What this does, in the model's own terms. This is its whole spec. */
  description: string
  params: ToolJsonSchema
  /** Cannot be undone. Always asks the user first. */
  irreversible?: boolean
  /** Rough cost hint used for pre-flight checks, in dollars. */
  costHint?: number
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

export function defineTool(tool: Tool): Tool {
  return tool
}

/* --------------------------------------------------------------- rendering */

/**
 * Renders a tool's arguments the way the trace shows them:
 *   search_places(q="plumber", near="home", radius=5km)
 *
 * Long values are cut so one span's row stays one line in the UI.
 */
export function describeArgs(tool: Tool, args: Record<string, unknown>): string {
  const spec = tool.params.properties
  const parts: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === '') continue
    const declared = (spec[key] as { type?: string } | undefined)?.type
    parts.push(`${key}=${renderValue(value, declared)}`)
  }
  return parts.join(', ')
}

function renderValue(value: unknown, type?: string): string {
  if (type === 'integer' || type === 'number' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)

  let text = typeof value === 'string' ? value : JSON.stringify(value)
  text = text.replace(/\s+/g, ' ').trim()

  // Anything multi-line becomes an explicit placeholder, so a five-line regex
  // can never blow out the row.
  const multiline = String(value).includes('\n')
  if (multiline && text.length > 46) text = `${String(value).split('\n')[0].slice(0, 40)}…`

  return `"${text.length > 120 ? `${text.slice(0, 118)}…` : text}"`
}

/** JSON Schema for the whole catalogue, ready to hand to the model. */
export function catalogue(tools: Tool[]): ToolJsonSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      tools.map((t) => [
        t.name,
        {
          type: 'object',
          description: `${t.description}${t.irreversible ? ' IRREVERSIBLE — requires the user to approve first.' : ''}`,
          properties: t.params.properties,
          required: t.params.required ?? [],
          additionalProperties: false
        }
      ])
    ),
    required: tools.map((t) => t.name)
  }
}

/** The tool list as compact text for the planner's prompt. */
export function catalogueText(tools: Tool[]): string {
  return tools
    .map((t) => {
      const args = Object.entries(t.params.properties)
        .map(([k, v]) => `${k}: ${(v as { type?: string }).type ?? 'string'}`)
        .join(', ')
      return `- ${t.name}(${args})${t.irreversible ? '  [IRREVERSIBLE — needs approval]' : ''}\n    ${t.description}`
    })
    .join('\n')
}
