import React, { useState } from 'react'
import { Copy, Download, Check } from 'lucide-react'

const DEMO_CODE = `// Agent 调度示例
export function route(userMessage: string): string {
  // 关键词优先级：先静态匹配
  if (/架构|mermaid/.test(userMessage)) return 'architect'
  if (/研究|调研/.test(userMessage)) return 'researcher'
  if (/测试|审查|bug/.test(userMessage)) return 'qa'
  // 兜底：LLM 决策
  return 'leader'
}`

interface CodeEditorProps {
  initialCode?: string
  filename?: string
  language?: string
}

/** 轻量代码编辑器（行号 + 语法高亮底色 + 保存/复制）。完整 Monaco 集成见计划 3.1。 */
export const CodeEditor: React.FC<CodeEditorProps> = ({ initialCode = DEMO_CODE, filename = 'demo.ts', language = 'ts' }) => {
  const [code, setCode] = useState(initialCode)
  const [saved, setSaved] = useState(false)
  const lineCount = code.split('\n').length

  const copy = () => navigator.clipboard?.writeText(code).catch(() => undefined)
  const save = () => {
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-brutal-black">
        <span className="font-bold text-xs flex-1">{filename} <span className="text-black/40 font-mono">· {language}</span></span>
        <button onClick={copy} className="p-1 border-2 border-brutal-black hover:bg-brutal-cream shadow-brutal-sm transition-all duration-150" title="复制"><Copy size={12} /></button>
        <button onClick={save} className={`p-1.5 border-2 border-brutal-black shadow-brutal-sm hover:-translate-y-[1px] active:translate-y-0 transition-all duration-150 ${saved ? 'bg-brutal-lime' : 'bg-brutal-yellow'}`} title="保存为文件">{saved ? <Check size={12} /> : <Download size={12} />}</button>
      </div>

      <div className="flex-1 flex overflow-auto bg-[#141111]">
        <div className="w-10 flex-shrink-0 bg-black/50 text-brutal-yellow/60 text-right pr-2 py-3 font-mono text-[11px] leading-5 select-none">
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent text-brutal-cream font-mono text-[11px] leading-5 p-3 outline-none resize-none whitespace-pre"
          wrap="off"
        />
      </div>

      <div className="px-3 py-1.5 border-t-2 border-brutal-black text-[10px] font-mono text-black/50">
        {lineCount} 行 · {code.length} 字符
      </div>
    </div>
  )
}