/**
 * PDF 服务层（PENDING_UPDATE A/E 表 · 1.8 / 3.4）
 * 高层封装：读取 → 分类 → 结构化提取，供 Arthur/Amelia 复用。
 * 底层优先尝试 @firecrawl/pdf-inspector CLI（若本机可用），否则回退到内置 pdf-parse 提取。
 */

import { PDFParse } from 'pdf-parse'
import type { PlatformAPI } from '../api/platformAPI'

export type PdfCategory =
  | 'resume/attach'      // 简历/附件
  | 'legal'              // 合同/条款/法务
  | 'report'             // 报告/说明
  | 'paper'              // 论文/文献
  | 'invoice'            // 票据/账单
  | 'doc'                // 通用文档
  | 'scan'               // 扫描件（无文本层）

export interface PdfInspectResult {
  pageCount: number
  category: PdfCategory
  title?: string
  text: string
  structured?: Record<string, string[]>
  source: 'pdf-inspector' | 'pdf-parse' | 'none'
}

/** 尝试探测本机是否安装了 @firecrawl/pdf-inspector CLI */
export async function hasPdfInspector(platform: PlatformAPI): Promise<boolean> {
  const { exitCode } = await platform.os.execCommand('pdf-inspector --help', 8000)
  return exitCode === 0
}

/** 通过 pdf-inspector CLI 解析（最佳路径） */
async function viaPdfInspector(platform: PlatformAPI, filePath: string): Promise<PdfInspectResult | null> {
  try {
    const { stdout } = await platform.os.execCommand(`pdf-inspector "${filePath}"`, 60_000)
    // CLI 通常输出 JSON 结构化结果；无则回退
    try {
      const data = JSON.parse(stdout)
      return {
        pageCount: data.pageCount ?? 1,
        category: mapCategory(data.category),
        title: data.title,
        text: data.text || data.markdown || '',
        structured: data.extracted,
        source: 'pdf-inspector',
      }
    } catch {
      return { pageCount: 1, category: 'doc', text: stdout, source: 'pdf-inspector' }
    }
  } catch {
    return null
  }
}

function mapCategory(c?: string): PdfCategory {
  switch (c) {
    case 'resume': case 'attach': return 'resume/attach'
    case 'legal': case 'contract': return 'legal'
    case 'report': return 'report'
    case 'paper': case 'article': return 'paper'
    case 'invoice': case 'bill': return 'invoice'
    case 'scan': return 'scan'
    default: return 'doc'
  }
}

/** 读取 PDF 并做基础分类/提取 */
export async function inspectPdf(platform: PlatformAPI, filePath: string): Promise<PdfInspectResult> {
  // 1) 尝试 pdf-inspector CLI
  if (await hasPdfInspector(platform)) {
    const via = await viaPdfInspector(platform, filePath)
    if (via) return via
  }

  // 2) 回退：内置 pdf-parse
  const { content, error } = await platform.fs.readBinaryFile(filePath)
  if (content == null) return { pageCount: 0, category: 'scan', text: '', source: 'none', structured: { error: [error || 'read failed'] } }
  try {
    const parser = new PDFParse({ data: new Uint8Array(content) })
    const result = await parser.getText()
    const text = result.text || ''
    const pageCount = result.numpages || 0
    const category: PdfCategory = text.trim().length < 20 ? 'scan' : (text.toLowerCase().includes('contract') || text.toLowerCase().includes('条款') ? 'legal' : 'doc')
    return { pageCount, category, text, source: 'pdf-parse' }
  } catch (e: any) {
    return { pageCount: 0, category: 'scan', text: '', source: 'none', structured: { error: [e?.message || 'parse failed'] } }
  }
}

/** 从 PDF 文本中按关键词结构化抽取字段（K/V） */
export function extractFields(text: string, keywords: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const kw of keywords) {
    const re = new RegExp(`${kw}[：:\\s]*([^\\n，。；]*)[\\n，,。；]?`, 'gi')
    const found: string[] = []
    let m: RegExpExecArray | null
    const safe = new RegExp(re.source, 'gi')
    while ((m = safe.exec(text)) !== null && found.length < 3) {
      const val = m[1]?.trim()
      if (val) found.push(val)
    }
    if (found.length) out[kw] = found
  }
  return out
}