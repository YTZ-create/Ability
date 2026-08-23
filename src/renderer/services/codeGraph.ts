/**
 * 代码调用关系分析（PENDING_UPDATE A / H 表 · 1.10）
 * 轻量静态分析：扫描 TS/JS 文件，提取 import 边与函数调用边，供 Atlas/Avery 使用。
 * 纯正则实现，无外部依赖；足够支撑「模块依赖图 / 受影响的调用方」等场景。
 */

import type { PlatformFS } from '../api/platformAPI'

export interface CodeNode {
  /** 模块路径（相对 projectRoot） */
  module: string
  /** 导出的符号名（可能为空） */
  export?: string
  /** 文件类型 */
  kind: 'file' | 'function' | 'class'
}

export interface CodeEdge {
  source: CodeNode
  target: CodeNode
  type: 'import' | 'call'
}

export interface CodeGraphResult {
  nodes: CodeNode[]
  edges: CodeEdge[]
  errors: { module: string; message: string }[]
}

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out',
  '__pycache__', '.venv', 'coverage', '.cache',
])

const IMPORT_RE = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g
const EXPORT_RE = /(?:export\s+(?:default\s+)?(?:function|class|const)\s+|export\s*(?:\{|function|class|const))\s*([\w$]+)?/g
const CALL_RE = /([\w$]+)\s*\(/g
const REL_RE = /^[.\/]/ // 相对路径或以 ./ ../ 开头

function normalizeModule(spec: string, fromModule: string): string {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const fromDir = fromModule.split('/').slice(0, -1).join('/')
    const segs = (fromDir ? fromDir.split('/') : []).slice()
    for (const part of spec.split('/')) {
      if (part === '..') segs.pop()
      else if (part !== '.' && part !== '') segs.push(part)
    }
    return segs.join('/')
  }
  return spec
}

/** 解析单个源文件，返回导出的边（import 边 + 本文件内函数调用边） */
export function analyzeSource(source: string, module: string, out: CodeEdge[]): Set<string> {
  const localFn = new Set<string>()
  // 收集本地声明的函数/类名
  for (const m of source.matchAll(EXPORT_RE)) {
    if (m[1]) {
      localFn.add(m[1])
      // 本文件导出的函数：补一个 to-undefined 调用边占位（仅记录节点，不落边）
      out.push({
        source: { module, export: m[1], kind: 'function' },
        target: { module, kind: 'file' },
        type: 'call',
      })
    }
  }
  // 非导出局部函数
  for (const m of source.matchAll(/(?:function|class)\s+([\w$]+)/g)) localFn.add(m[1])

  // import 边
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1]
    if (REL_RE.test(spec)) {
      const target = normalizeModule(spec, module)
      out.push({
        source: { module, kind: 'file' },
        target: { module: target, kind: 'file' },
        type: 'import',
      })
    } else {
      out.push({
        source: { module, kind: 'file' },
        target: { module: spec, kind: 'file' },
        type: 'import',
      })
    }
  }
  return localFn
}

/**
 * 对 projectRoot 下的代码做全量调用关系分析。
 * 返回节点与边；本函数只做静态边提取，不做类型推理。
 */
export async function analyzeCodeGraph(fs: PlatformFS, projectRoot: string): Promise<CodeGraphResult> {
  const result: CodeGraphResult = { nodes: [], edges: [], errors: [] }
  const moduleSet = new Set<string>()

  async function walk(dir: string): Promise<void> {
    const tree = await fs.scanDirectory(dir)
    for (const entry of tree) {
      if (entry.isDirectory) {
        const base = entry.name
        if (SKIP_DIRS.has(base)) continue
        await walk(entry.path)
      } else {
        const ext = entry.ext ? entry.ext.toLowerCase() : ''
        if (!TS_EXTS.has(ext)) continue
        const rel = entry.path.replace(projectRoot, '').replace(/^[/\\]/, '').replace(/\\/g, '/')
        moduleSet.add(rel)
        const { content } = await fs.readFile(entry.path)
        if (content == null) continue
        try {
          analyzeSource(content, rel, result.edges)
        } catch (e: any) {
          result.errors.push({ module: rel, message: e?.message || 'parse error' })
        }
      }
    }
  }

  await walk(projectRoot)
  for (const module of moduleSet) result.nodes.push({ module, kind: 'file' })
  return result
}

/** 找出「直接调用/依赖某模块」的所有上游模块（反向依赖） */
export function findReferrers(graph: CodeGraphResult, targetModule: string): CodeNode[] {
  const refs = new Map<string, CodeNode>()
  for (const e of graph.edges) {
    if (e.type === 'import' && (e.target.module === targetModule || e.target.module === normalizeModule(targetModule, e.source.module))) {
      refs.set(e.source.module, e.source)
    }
  }
  return [...refs.values()]
}

/** 汇总每个模块的依赖数（出度）与被依赖数（入度） */
export function moduleStats(
  graph: CodeGraphResult
): { module: string; deps: number; dependents: number }[] {
  const out = new Map<string, { module: string; deps: number; dependents: number }>()
  const bump = (m: string, field: 'deps' | 'dependents') => {
    const r = out.get(m) || { module: m, deps: 0, dependents: 0 }
    r[field]++
    out.set(m, r)
  }
  for (const e of graph.edges) {
    if (e.type === 'import') {
      bump(e.source.module, 'deps')
      bump(e.target.module, 'dependents')
    }
  }
  return [...out.values()].sort((a, b) => b.dependents - a.dependents)
}