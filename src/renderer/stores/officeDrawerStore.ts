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
  /**
   * 文档编辑器容器版本号：每次整体重建编辑器（导入等）时 +1，
   * OfficePanel 用它作为容器 div 的 React key，强制创建全新容器元素
   * （Univer 的 React root 按容器元素缓存，旧元素复用会导致挂载静默失败）
   */
  docsVersion: number

  open: () => void
  close: () => void
  toggle: () => void
  setWidth: (w: number) => void
  reset: () => void
  setSheetsFeedback: (msg: string | null) => void
  setDocsFeedback: (msg: string | null) => void
  setActiveKind: (kind: 'sheets' | 'docs') => void
  bumpDocsVersion: () => void
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
  docsVersion: 0,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  setWidth: (w) => set({ width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)) }),
  reset: () => set({ isOpen: false, width: DEFAULT_WIDTH }),
  setSheetsFeedback: (msg) => set({ sheetsFeedback: msg }),
  setDocsFeedback: (msg) => set({ docsFeedback: msg }),
  setActiveKind: (kind) => set({ activeKind: kind }),
  bumpDocsVersion: () => set((s) => ({ docsVersion: s.docsVersion + 1 })),
}))

export const OFFICE_DRAWER_MIN_WIDTH = MIN_WIDTH
export const OFFICE_DRAWER_MAX_WIDTH = MAX_WIDTH
export const OFFICE_DRAWER_DEFAULT_WIDTH = DEFAULT_WIDTH