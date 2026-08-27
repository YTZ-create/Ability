/**
 * officeStore — 工作簿/文档状态管理
 *
 * 管理办公项（工作簿/文档）列表、draft/ready 状态、审批流
 * 使用 Zustand（项目现有模式）
 */

import { create } from 'zustand'

export type OfficeItemType = 'workbook' | 'document'

export interface OfficeItem {
  id: string
  type: OfficeItemType
  name: string
  state: 'draft' | 'ready'
  createdAt: number
  updatedAt: number
  description?: string
}

export type WorkbookInfo = OfficeItem & { type: 'workbook' }
export type DocumentInfo = OfficeItem & { type: 'document' }

interface OfficeState {
  workbooks: OfficeItem[]
  currentWorkbookId: string | null

  /** 添加工作簿 */
  addWorkbook: (info: Omit<WorkbookInfo, 'createdAt' | 'updatedAt' | 'type'>) => void
  /** 添加文档 */
  addDocument: (info: Omit<DocumentInfo, 'createdAt' | 'updatedAt' | 'type'>) => void
  /** 更新办公项状态 */
  updateWorkbookState: (id: string, state: 'draft' | 'ready') => void
  /** 设置当前办公项 */
  setCurrentWorkbook: (id: string | null) => void
  /** 审批通过（draft → ready） */
  approve: (id: string) => void
  /** 丢弃草稿 */
  discard: (id: string) => void
  /** 清空全部 */
  reset: () => void
}

export const useOfficeStore = create<OfficeState>((set) => ({
  workbooks: [],
  currentWorkbookId: null,

  addWorkbook: (info) =>
    set((s) => ({
      workbooks: [
        ...s.workbooks,
        {
          ...info,
          type: 'workbook',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    })),

  addDocument: (info) =>
    set((s) => ({
      workbooks: [
        ...s.workbooks,
        {
          ...info,
          type: 'document',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    })),

  updateWorkbookState: (id, state) =>
    set((s) => ({
      workbooks: s.workbooks.map((w) =>
        w.id === id ? { ...w, state, updatedAt: Date.now() } : w
      ),
    })),

  setCurrentWorkbook: (id) => set({ currentWorkbookId: id }),

  approve: (id) =>
    set((s) => ({
      workbooks: s.workbooks.map((w) =>
        w.id === id ? { ...w, state: 'ready', updatedAt: Date.now() } : w
      ),
    })),

  discard: (id) =>
    set((s) => ({
      workbooks: s.workbooks.filter((w) => w.id !== id),
      currentWorkbookId: s.currentWorkbookId === id ? null : s.currentWorkbookId,
    })),

  reset: () => set({ workbooks: [], currentWorkbookId: null }),
}))