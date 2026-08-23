import React, { useMemo, useState } from 'react'
import { Download, Eye, Code2 } from 'lucide-react'

const DEMO_MD = `# 能力扩展报告

## 一、团队变化
- Agent 团队由 **7 人扩展至 11 人**
- 新增 *Atlas / Audrey / Avery / Aurora / Aria / Arthur / Alice*

## 二、记忆系统
- Oliver 新增跨会话记忆调度（记住/回忆/遗忘/统计）

## 三、能力面板
1. 代码 Diff 预览
2. 深度研究评估备忘录
3. HTML 幻灯片与报告

> 全程保持 Brutalist 设计一致`

function mdToHtml(md: string): string {
  const safe = md.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
  const lines = safe.split('\n')
  const html: string[] = ['<div class="report">']
  let list = ''
  const closeList = () => {
    if (list) { html.push(`</ul>`); list = '' }
  }
  let inBlockquote = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('> ')) {
      if (!inBlockquote) { html.push('<blockquote>'); inBlockquote = true }
      html.push(`<p>${line.slice(2)}</p>`)
      continue
    } else if (inBlockquote) { html.push('</blockquote>'); inBlockquote = false }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) { closeList(); const lv = heading[1].length; html.push(`<h${lv}>${heading[2]}</h${lv}>`); continue }
    const item = line.match(/^[-*+]\s+(.*)$/)
    if (item) { if (!list) { html.push('<ul>'); list = '' } html.push(`<li>${item[1]}</li>`); continue }
    const num = line.match(/^\d+\.\s+(.*)$/)
    if (num) { if (!list) { html.push('<ul>'); list = '' } html.push(`<li>${num[1]}</li>`); continue }
    closeList()
    if (line === '') continue
    html.push(`<p>${line}</p>`)
  }
  closeList()
  html.push('</div>')
  return html.join('\n')
}

export const HtmlReportExport: React.FC<{ markdown?: string; title?: string }> = ({ markdown = DEMO_MD, title = 'HTML 报告导出' }) => {
  const [md, setMd] = useState(markdown)
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const html = useMemo(() => mdToHtml(md), [md])

  const download = () => {
    const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>报告</title><style>
      body{font-family:sans-serif;background:#FFFAEF;color:#1A1A1A;padding:32px}
      .report{border:3px solid #1A1A1A;background:#fff;box-shadow:6px 6px 0 #1A1A1A;padding:24px;max-width:860px;margin:0 auto}
      h1,h2,h3{border-bottom:3px solid #FFC857;display:inline-block}
      blockquote{border-left:4px solid #FFC857;margin:0;padding:4px 12px;background:#FFF4D6}
    </style></head><body>${html}</body></html>`], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'report.html'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-1 px-3 py-2 border-b-2 border-brutal-black">
        <span className="font-bold text-xs flex-1">{title}</span>
        <button onClick={() => setView('preview')} className={`p-1 border-2 border-brutal-black ${view === 'preview' ? 'bg-brutal-yellow' : 'hover:bg-brutal-cream'} transition-colors`} title="预览"><Eye size={12} /></button>
        <button onClick={() => setView('code')} className={`p-1 border-2 border-brutal-black ${view === 'code' ? 'bg-brutal-yellow' : 'hover:bg-brutal-cream'} transition-colors`} title="源码"><Code2 size={12} /></button>
        <button onClick={download} className="ml-1 p-1.5 border-2 border-brutal-black bg-brutal-lime hover:shadow-brutal-sm hover:-translate-y-[1px] active:translate-y-0 transition-all duration-150" title="导出 HTML"><Download size={12} /></button>
      </div>

      {view === 'preview' ? (
        <div className="flex-1 p-3 overflow-auto bg-brutal-cream">
          <iframe title="report-preview" srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;background:#FFFAEF;color:#1A1A1A;padding:16px}.report{border:3px solid #1A1A1A;background:#fff;box-shadow:6px 6px 0 #1A1A1A;padding:24px}h1,h2,h3{display:inline-block}h1{border-bottom:3px solid #FFC857}h2{border-bottom:3px solid #FF6B91}h3{border-bottom:3px solid #A9D877}blockquote{border-left:4px solid #FFC857;margin:0;padding:4px 12px;background:#FFF4D6}strong{color:#000}</style></head><body>${html}</body></html>`} className="w-full h-full border-2 border-brutal-black bg-white" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3 bg-[#141111] text-brutal-lime text-[11px] font-mono whitespace-pre">{html}</div>
      )}

      <div className="px-3 py-2 border-t-2 border-brutal-black">
        <div className="text-[10px] font-bold mb-1">Markdown 源</div>
        <textarea value={md} onChange={(e) => setMd(e.target.value)} className="w-full h-24 input-brutal !text-[10px] !py-1.5 font-mono resize-none" />
      </div>
    </div>
  )
}