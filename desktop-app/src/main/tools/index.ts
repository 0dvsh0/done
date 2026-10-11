import type { Tool } from './types'
import { webFetch, webSearch } from './web'
import {
  browserClick,
  browserClose,
  browserOpen,
  browserRead,
  browserScreenshot,
  browserSubmit,
  browserType
} from './browser'
import { fileList, fileRead, fileSearch, fileWrite } from './files'
import { clipboardRead, clipboardWrite, openUrl, shellRun, systemInfo } from './computer'
import { codeAgent } from './code'

/* ==========================================================================
   What this agent can actually do.

   Everything in this list performs real work against the real machine or the
   real network. There is no scripted adapter and no simulated latency: a tool
   takes exactly as long as the thing it is doing takes, and returns exactly
   what happened.

   `irreversible` tools are the ones the product promises never to run on
   their own. They are marked here, and the policy engine in agent.ts reads
   this same flag — so the promise and the enforcement are the same line of
   code rather than two that can drift apart.
   ========================================================================== */

export const TOOLS: Tool[] = [
  webSearch,
  webFetch,
  browserOpen,
  browserRead,
  browserClick,
  browserType,
  browserSubmit,
  browserScreenshot,
  browserClose,
  fileList,
  fileRead,
  fileWrite,
  fileSearch,
  shellRun,
  systemInfo,
  clipboardRead,
  clipboardWrite,
  openUrl,
  codeAgent
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

export function toolNames(): string[] {
  return TOOLS.map((t) => t.name)
}

export * from './types'
