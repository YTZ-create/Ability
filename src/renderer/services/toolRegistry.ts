/**
 * 工具索引（PENDING_UPDATE A / H 表 · 借鉴 reverse-skill）
 * 自动扫描本机可用 CLI 工具，供 Agent 路由规则（routing.json）引用。
 * 通过 PlatformOS.execCommand 探测工具存在性。
 */

import type { PlatformOS } from '../api/platformAPI'

/** 常见工具与其探测值（version 命令行参数退化到 --version/-v） */
const PROBES: { name: string; command: string; args?: string[] }[] = [
  { name: 'node', command: 'node', args: ['--version'] },
  { name: 'npm', command: 'npm', args: ['--version'] },
  { name: 'git', command: 'git', args: ['--version'] },
  { name: 'python', command: 'python', args: ['--version'] },
  { name: 'python3', command: 'python3', args: ['--version'] },
  { name: 'tsc', command: 'tsc', args: ['--version'] },
  { name: 'ffmpeg', command: 'ffmpeg', args: ['-version'] },
  { name: 'jq', command: 'jq', args: ['--version'] },
  { name: 'curl', command: 'curl', args: ['--version'] },
  { name: 'grep', command: 'grep', args: ['--version'] },
  { name: 'code', command: 'code', args: ['--version'] },
  { name: 'docker', command: 'docker', args: ['--version'] },
  { name: 'pnpm', command: 'pnpm', args: ['--version'] },
  { name: 'yarn', command: 'yarn', args: ['--version'] },
  { name: 'gradle', command: 'gradle', args: ['--version'] },
  { name: 'mvn', command: 'mvn', args: ['--version'] },
]

export interface ToolEntry {
  name: string
  command: string
  available: boolean
  version?: string
}

interface ToolRegistryState {
  tools: ToolEntry[]
  scannedAt: number | null
  scanning: boolean
}

export class ToolRegistry {
  private state: ToolRegistryState = { tools: [], scannedAt: null, scanning: false }
  constructor(private os: PlatformOS) {}

  /** 探测全部预设工具，缓存结果到本次运行 */
  async scan(force = false): Promise<ToolEntry[]> {
    if (this.state.scanning) return this.state.tools
    if (this.state.scannedAt && !force) return this.state.tools
    this.state.scanning = true
    try {
      const results = await Promise.all(
        PROBES.map(async (p) => {
          try {
            const { exitCode, stdout, stderr } = await this.os.execCommand(
              [p.command, ...(p.args || [])].join(' ')
            )
            const available = exitCode === 0
            const version = (stdout || stderr).split(/[\r\n]/)[0]?.trim() || undefined
            return { name: p.name, command: p.command, available, version }
          } catch {
            return { name: p.name, command: p.command, available: false }
          }
        })
      )
      this.state.tools = results
      this.state.scannedAt = Date.now()
      return results
    } finally {
      this.state.scanning = false
    }
  }

  getTools(): ToolEntry[] { return this.state.tools }
  isAvailable(name: string): boolean {
    return this.state.tools.some((t) => t.name === name && t.available)
  }
  find(name: string): ToolEntry | undefined {
    return this.state.tools.find((t) => t.name === name)
  }
}

let _instance: ToolRegistry | null = null
/** 全局单例。需在 app 启动时注入 os 平台实例。 */
export function getToolRegistry(os: PlatformOS): ToolRegistry {
  if (!_instance) _instance = new ToolRegistry(os)
  return _instance
}