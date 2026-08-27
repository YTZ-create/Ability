import { create } from 'zustand'

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  category: 'lark' | 'seedream' | 'seedance' | 'browser' | 'skill' | 'office'
}

interface PluginState {
  plugins: PluginInfo[]
  toggle: (id: string) => void
}

export const usePluginStore = create<PluginState>((set) => ({
  plugins: [
    { id: 'lark', name: '飞书 Lark', version: '0.1.0', description: '消息/日历/任务/文档/表格/会议纪要全流程', enabled: false, category: 'lark' },
    { id: 'seedream', name: 'Seedream 文生图', version: '0.1.0', description: 'AI 图片生成服务', enabled: false, category: 'seedream' },
    { id: 'seedance', name: 'Seedance 视频生成', version: '0.1.0', description: 'AI 视频生成服务', enabled: false, category: 'seedance' },
    { id: 'browser', name: '浏览器控制', version: '0.1.0', description: 'Alice 使用的网页自动化能力', enabled: true, category: 'browser' },
    { id: 'diagram-design', name: 'diagram-design Skill', version: '0.1.0', description: '27 种编辑级图表视觉类型', enabled: false, category: 'skill' },
    { id: 'open-code-review', name: 'Open Code Review', version: '0.1.0', description: 'Avery 行级精度代码审查 CLI', enabled: false, category: 'skill' },
    { id: 'univer-office', name: '办公文档 (Univer)', version: '0.1.0', description: 'Univer 电子表格编辑与预览', enabled: false, category: 'office' },
  ],
  toggle: (id) => set((s) => ({ plugins: s.plugins.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)) })),
}))