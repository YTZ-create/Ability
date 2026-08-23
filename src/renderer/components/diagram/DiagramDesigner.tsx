import React, { useMemo, useState } from 'react'
import { Code2, Eye, Download } from 'lucide-react'

/** 极简流图示例（234px 网格），用于在图表面板预览 */
const DEMO_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;font-family:ui-monospace,monospace}
  body{margin:0;background:#FFFAEF;color:#1A1A1A;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .flow{display:flex;flex-direction:column;gap:12px}
  .box{border:3px solid #1A1A1A;background:#fff;box-shadow:5px 5px 0 #1A1A1A;padding:16px 20px;font-weight:800}
  .box span{display:inline-block;width:10px;height:10px;border:2px solid #1A1A1A;margin-right:8px}
  .arrow{text-align:center;font-weight:800}
</style></head><body>
  <div class="flow">
    <div class="box"><span style="background:#FFC857"></span>用户请求</div>
    <div class="arrow">▼</div>
    <div class="box"><span style="background:#FF6B91"></span>Oliver 调度</div>
    <div class="arrow">▼</div>
    <div class="box"><span style="background:#A9D877"></span>子 Agent 执行</div>
    <div class="arrow">▼</div>
    <div class="box"><span style="background:#27CCF3"></span>结果回显</div>
  </div>
</body></html>`

/** diagram-design skill：27 种视觉类型 → standalone HTML 模板（Brutalist） */
const U_TYPES: { id: string; label: string; build: () => string }[] = [
  { id: 'u01', label: '流程图', build: () => flowTemplate() },
  { id: 'u07', label: '系统架构图', build: () => archTemplate() },
  { id: 'u18', label: '柱状图', build: () => barTemplate() },
  { id: 'u20', label: '占比环形图', build: () => donutTemplate() },
  { id: 'u15', label: '思维导图', build: () => mindTemplate() },
]

function shell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace}
  body{margin:24px;background:#FFFAEF;color:#1A1A1A;font-size:13px}
  .cap{font-weight:800;font-size:11px;text-transform:uppercase;background:#FFC857;
       display:inline-block;padding:3px 10px;border:2px solid #1A1A1A;margin-bottom:16px}
  .box{border:3px solid #1A1A1A;background:#fff;box-shadow:5px 5px 0 #1A1A1A;padding:14px 18px;font-weight:800;border-radius:0}
  .arrow{height:18px;text-align:center;font-weight:800}
</style></head><body><div class="cap">diagram-design · ${title}</div>${body}</body></html>`
}

function flowTemplate(): string {
  return shell('流程图', `
  <div class="box">用户请求</div><div class="arrow">▼</div>
  <div class="box">Oliver 调度</div><div class="arrow">▼</div>
  <div class="box">子 Agent 执行</div><div class="arrow">▼</div>
  <div class="box">结果回显</div>`)
}
function archTemplate(): string {
  return shell('系统架构图', `
  <div class="box">UI 组件</div><div class="box">Stores</div><div class="box">PlatformAPI</div>
  <div class="arrow">▼</div>
  <div class="box">Services · scheduler / toolRegistry / codeGraph</div>`)
}
function barTemplate(): string {
  return shell('柱状图', `
  <div style="display:flex;align-items:flex-end;gap:12px;padding-top:80px">
    <div style="border:3px solid #1A1A1A;background:#FFC857;box-shadow:5px 5px 0 #1A1A1A;width:54px;height:120px"></div>
    <div style="border:3px solid #1A1A1A;background:#FF6B91;box-shadow:5px 5px 0 #1A1A1A;width:54px;height:180px"></div>
    <div style="border:3px solid #1A1A1A;background:#A9D877;box-shadow:5px 5px 0 #1A1A1A;width:54px;height:90px"></div>
    <div style="border:3px solid #1A1A1A;background:#27CCF3;box-shadow:5px 5px 0 #1A1A1A;width:54px;height:150px"></div>
  </div>`)
}
function donutTemplate(): string {
  return shell('占比环形图', `
  <div class="box">A · B · C · D（环形占比示例，换上真实占比即可）</div>`)
}
function mindTemplate(): string {
  return shell('思维导图', `
  <div class="box">中心主题</div><div class="arrow">◀</div><div class="box">分支一</div>
  <div class="arrow"></div><div class="box">分支二</div>`)
}

interface DiagramDesignerProps {
  html?: string
  title?: string
}

export const DiagramDesigner: React.FC<DiagramDesignerProps> = ({ html: initialHtml, title = '编辑级图表渲染' }) => {
  const [html, setHtml] = useState(initialHtml || DEMO_HTML)
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const srcDoc = useMemo(() => html, [html])

  const download = () => {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'diagram.html'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-1 px-3 py-2 border-b-2 border-brutal-black">
        <span className="font-bold text-xs flex-1">{title}</span>
        <select
          onChange={(e) => { const t = U_TYPES.find((u) => u.id === e.target.value); if (t) setHtml(t.build()) }}
          className="p-1 border-2 border-brutal-black bg-brutal-cream text-[10px] font-bold focus:outline-none"
          title="diagram-design · 切换视觉类型模板"
        >
          <option value="">+ 视觉类型</option>
          {U_TYPES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
        <button onClick={() => setView('preview')} className={`p-1 border-2 border-brutal-black ${view === 'preview' ? 'bg-brutal-yellow' : 'hover:bg-brutal-cream'} transition-colors`} title="预览"><Eye size={12} /></button>
        <button onClick={() => setView('code')} className={`p-1 border-2 border-brutal-black ${view === 'code' ? 'bg-brutal-yellow' : 'hover:bg-brutal-cream'} transition-colors`} title="HTML 源码"><Code2 size={12} /></button>
        <button onClick={download} className="ml-1 p-1.5 border-2 border-brutal-black bg-brutal-lavender hover:shadow-brutal-sm hover:-translate-y-[1px] active:translate-y-0 transition-all duration-150" title="导出独立 HTML"><Download size={12} /></button>
      </div>

      {view === 'preview' ? (
        <div className="flex-1 p-2 overflow-auto bg-brutal-cream">
          <iframe title="diagram-preview" srcDoc={srcDoc} className="w-full h-full border-2 border-brutal-black bg-white" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3 bg-[#141111] text-brutal-yellow text-[11px] font-mono whitespace-pre">{html}</div>
      )}

      <div className="px-3 py-2 border-t-2 border-brutal-black">
        <div className="text-[10px] font-bold mb-1">standalone HTML 源码（支持 27 种视觉类型）</div>
        <textarea value={html} onChange={(e) => setHtml(e.target.value)} className="w-full h-28 input-brutal !text-[10px] !py-1.5 font-mono resize-none" spellCheck={false} />
      </div>
    </div>
  )
}