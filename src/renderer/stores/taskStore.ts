import { create } from 'zustand'

export interface ScheduledTask {
  id: string
  name: string
  cron: string
  description: string
  enabled: boolean
  createdAt: number
  lastRunAt: number | null
}

interface TaskState {
  tasks: ScheduledTask[]
  addTask: (t: Omit<ScheduledTask, 'id' | 'createdAt' | 'lastRunAt' | 'enabled'>) => void
  updateTask: (id: string, patch: Partial<ScheduledTask>) => void
  removeTask: (id: string) => void
  toggleTask: (id: string) => void
  markRun: (id: string) => void
}

let seed = 0

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [
    {
      id: 'task-tpl-weekly',
      name: '每周代码质量检查',
      cron: '0 9 * * 1',
      description: '每周一上午 9 点运行一轮静态检查',
      enabled: true,
      createdAt: Date.now(),
      lastRunAt: null,
    },
    {
      id: 'task-tpl-news',
      name: '每日新闻摘要',
      cron: '0 8 * * *',
      description: '每天上午 8 点拉取资讯并生成摘要',
      enabled: false,
      createdAt: Date.now(),
      lastRunAt: null,
    },
  ],
  addTask: (t) =>
    set((s) => ({
      tasks: [
        { ...t, id: `task-${Date.now()}-${++seed}`, enabled: true, createdAt: Date.now(), lastRunAt: null },
        ...s.tasks,
      ],
    })),
  updateTask: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  toggleTask: (id) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)) })),
  markRun: (id) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, lastRunAt: Date.now() } : t)) })),
}))