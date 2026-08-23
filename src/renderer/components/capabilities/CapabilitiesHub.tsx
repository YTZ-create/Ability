import React, { useState } from 'react'
import { Code2, FileDiff, FileStack, LayoutPanelTop, MonitorPlay, Newspaper, Workflow, Clock, Puzzle, ArrowLeft } from 'lucide-react'
import { CodeEditor } from '../editor/CodeEditor'
import { DiffViewer } from '../diff/DiffViewer'
import { EvaluationMemo } from '../research/EvaluationMemo'
import { FileManager } from '../files/FileManager'
import { SlideDeck } from '../slides/SlideDeck'
import { HtmlReportExport } from '../report/HtmlReportExport'
import { DiagramDesigner } from '../diagram/DiagramDesigner'
import { TaskPanel } from '../tasks/TaskPanel'
import { PluginPanel } from '../plugins/PluginPanel'

export type CapabilityId =
  | 'code-editor'
  | 'diff'
  | 'evaluation'
  | 'file-manager'
  | 'slides'
  | 'report'
  | 'diagram'
  | 'tasks'
  | 'plugins'

interface CapabilityDef {
  id: CapabilityId
  name: string
  desc: string
  agent: string
  icon: React.ComponentType<{ size?: number | string }>
  color: string
}

const CAPABILITIES: CapabilityDef[] = [
  { id: 'code-editor', name: '代码编辑器', desc: '直接查看与保存源码', agent: 'Atlas/Avery', icon: Code2, color: '#A78BFA' },
  { id: 'diff', name: '代码 Diff / 审查', desc: '修改前后对比 + 行级审查意见', agent: 'Avery', icon: FileDiff, color: '#4ADE80' },
  { id: 'evaluation', name: '评估备忘录', desc: '深度研究的多标准评分对比', agent: 'Audrey', icon: FileStack, color: '#27CCF3' },
  { id: 'file-manager', name: '文件管理', desc: '分类 / 重命名 / 复制 / 删除', agent: 'Aurora', icon: LayoutPanelTop, color: '#F59E0B' },
  { id: 'slides', name: 'HTML 幻灯片', desc: '演示播放与全屏', agent: 'Arthur', icon: MonitorPlay, color: '#EC4899' },
  { id: 'report', name: 'HTML 报告', desc: 'Markdown 渲染与导出', agent: 'Arthur', icon: Newspaper, color: '#8B5CF6' },
  { id: 'diagram', name: '编辑级图表', desc: 'standalone HTML 图表渲染', agent: 'Atlas', icon: Workflow, color: '#FF6B91' },
  { id: 'tasks', name: '定时任务', desc: '创建 / 暂停 / 立即执行', agent: 'Aurora', icon: Clock, color: '#FFD440' },
  { id: 'plugins', name: '插件管理', desc: '启用 / 停用已接入插件', agent: 'Alice', icon: Puzzle, color: '#06B6D4' },
]

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="text-[8px] font-bold text-black/70 font-mono px-1 border border-brutal-black rounded-[3px] bg-white"
      style={{ boxShadow: `1.5px 1.5px 0 ${color}` }}>
      {text}
    </span>
  )
}

const RENDERER: Record<CapabilityId, React.ReactElement> = {
  'code-editor': <CodeEditor />,
  'diff': <DiffViewer />,
  'evaluation': <EvaluationMemo />,
  'file-manager': <FileManager />,
  'slides': <SlideDeck />,
  'report': <HtmlReportExport />,
  'diagram': <DiagramDesigner />,
  'tasks': <TaskPanel />,
  'plugins': <PluginPanel />,
}

export const CapabilitiesHub: React.FC = () => {
  const [active, setActive] = useState<CapabilityId | null>(null)

  if (active) {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="flex items-center gap-2 px-2 py-1.5 border-b-2 border-brutal-black shrink-0">
          <button onClick={() => setActive(null)} className="p-1 border-2 border-brutal-black hover:bg-brutal-yellow shadow-brutal-sm transition-all duration-150" title="返回">
            <ArrowLeft size={12} />
          </button>
          <span className="font-bold text-xs flex-1">{CAPABILITIES.find((c) => c.id === active)?.name}</span>
        </div>
        <div className="flex-1 overflow-hidden">
          {RENDERER[active]}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-auto">
      <div className="px-3 py-2 border-b-2 border-brutal-black">
        <div className="font-bold text-xs">能力工具箱</div>
        <div className="text-[10px] text-black/60 font-mono">9 项能力 · 与各 Agent 一一对应</div>
      </div>
      <div className="p-3 grid grid-cols-1 gap-2.5">
        {CAPABILITIES.map((c) => {
          const Icon = c.icon
          return (
            <button key={c.id} onClick={() => setActive(c.id)}
              className="group text-left flex items-center gap-3 p-3 border-2 border-brutal-black bg-white shadow-brutal hover:shadow-brutal-xl hover:-translate-x-[2px] hover:-translate-y-[2px] active:shadow-none active:translate-x-0 active:translate-y-0 transition-all duration-150">
              <span className="w-9 h-9 flex items-center justify-center border-2 border-brutal-black rounded-[3px] flex-shrink-0"
                style={{ backgroundColor: c.color, boxShadow: '2px 2px 0 #141111' }}>
                <Icon size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-xs font-bold">{c.name}</span>
                  <Badge text={c.agent} color={c.color} />
                </span>
                <span className="block text-[10px] text-black/60 mt-0.5">{c.desc}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}