/**
 * officeDrawerStore — 全局控制办公文档抽屉的显示/隐藏/宽度
 *
 * 设计为 zustand store，方便在任何组件（TitleBar/CapabilitiesHub/MessageBubble/OfficeCard）
 * 中控制抽屉的显示
 */

import { create } from 'zustand'

interface OfficeDrawerState {
  isOpen: boolean
  width: number
  /** 工作表页反馈 */
  sheetsFeedback: string | null
  /** 文档页反馈 */
  docsFeedback: string | null
  /** 当前激活的编辑器页面，决定标题栏显示哪一页的反馈 */
  activeKind: 'sheets' | 'docs'

  open: () => void
  close: () => void
  toggle: () => void
  setWidth: (w: number) => void
  reset: () => void
  setSheetsFeedback: (msg: string | null) => void
  setDocsFeedback: (msg: string | null) => void
  setActiveKind: (kind: 'sheets' | 'docs') => void
}

const DEFAULT_WIDTH = 400
const MIN_WIDTH = 400
const MAX_WIDTH = 1200

export const useOfficeDrawerStore = create<OfficeDrawerState>((set) => ({
  isOpen: false,
  width: DEFAULT_WIDTH,
  sheetsFeedback: null,
  docsFeedback: null,
  activeKind: 'sheets',

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  setWidth: (w) => set({ width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)) }),
  reset: () => set({ isOpen: false, width: DEFAULT_WIDTH }),
  setSheetsFeedback: (msg) => set({ sheetsFeedback: msg }),
  setDocsFeedback: (msg) => set({ docsFeedback: msg }),
  setActiveKind: (kind) => set({ activeKind: kind }),
}))

export const OFFICE_DRAWER_MIN_WIDTH = MIN_WIDTH
export const OFFICE_DRAWER_MAX_WIDTH = MAX_WIDTH
export const OFFICE_DRAWER_DEFAULT_WIDTH = DEFAULT_WIDTH