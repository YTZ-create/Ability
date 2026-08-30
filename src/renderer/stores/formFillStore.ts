import { create } from 'zustand'
import type { FormField, FormDocument } from '../agents/formFiller'
import type { FileEntry } from '../api/platformAPI'
import { useChatStore } from './chatStore'
import type { FillMethod } from '../utils/docxHandler'
import { formDrawerSyncService, type DrawerSyncMode } from '../services/formDrawerSyncService'

interface FormFillState {
  activeDocument: FormDocument | null
  isProcessing: boolean
  isFormFillingSession: boolean
  formFillPhase: 'file-select' | 'select' | 'fill' | null
  selectedFieldIds: string[]
  availableFiles: FileEntry[]
  fillMethod: FillMethod
  /** Ethan 抽屉同步模式（M2）：null=无会话；'none'=开关关闭或文件不支持，走原有路线 */
  drawerSyncMode: DrawerSyncMode | null
  /** 抽屉同步异常提示（降级/不支持时给 UI 徽标展示） */
  drawerSyncError: string | null

  setActiveDocument: (doc: FormDocument | null) => void
  setIsProcessing: (v: boolean) => void
  setIsFormFillingSession: (v: boolean) => void
  setFormFillPhase: (phase: 'file-select' | 'select' | 'fill' | null) => void
  setSelectedFieldIds: (ids: string[]) => void
  setAvailableFiles: (files: FileEntry[]) => void
  setCurrentFieldIndex: (index: number) => void
  updateField: (fieldId: string, value: string, filledBy: 'user' | 'ai') => void
  updateFieldDeletePlaceholder: (fieldId: string, deletePlaceholder: boolean) => void
  nextField: () => void
  prevField: () => void
  setStatus: (status: FormDocument['status']) => void
  setFillMethod: (method: FillMethod) => void
  endSession: (filledFilePath?: string) => void
}

export const useFormFillStore = create<FormFillState>((set, get) => ({
  activeDocument: null,
  isProcessing: false,
  isFormFillingSession: false,
  formFillPhase: null,
  selectedFieldIds: [],
  availableFiles: [],
  fillMethod: 'word-com' as FillMethod,
  drawerSyncMode: null,
  drawerSyncError: null,

  setActiveDocument: (doc) => {
    set({ activeDocument: doc })
    // Ethan 抽屉同步（M2 钩子）：覆盖全部三个文件入口（FileSelector/ChatInput 直连/Leader 分发）。
    // 开关关闭时 autoImport 内部直接返回 'none'，行为与旧版一致
    if (doc) {
      void formDrawerSyncService.autoImport(doc).then((mode) => {
        set({
          drawerSyncMode: mode,
          drawerSyncError:
            mode === 'none' && formDrawerSyncService.isSyncEnabled()
              ? '该格式暂不支持抽屉同步，将按原有方式填写'
              : null,
        })
      })
    } else {
      set({ drawerSyncMode: null, drawerSyncError: null })
    }
  },
  setIsProcessing: (v) => set({ isProcessing: v }),
  setIsFormFillingSession: (v) => set({ isFormFillingSession: v }),
  setFormFillPhase: (phase) => set({ formFillPhase: phase }),
  setSelectedFieldIds: (ids) => set({ selectedFieldIds: ids }),
  setAvailableFiles: (files) => set({ availableFiles: files }),

  setCurrentFieldIndex: (index) =>
    set((s) => {
      if (!s.activeDocument) return s
      return { activeDocument: { ...s.activeDocument, currentFieldIndex: index } }
    }),

  updateField: (fieldId, value, filledBy) => {
    const prev = get()
    if (!prev.activeDocument) return
    const field = prev.activeDocument.fields.find((f) => f.id === fieldId)
    const updatedFields = prev.activeDocument.fields.map((f) =>
      f.id === fieldId ? { ...f, value, filledBy } : f
    )
    set((s) => ({ activeDocument: s.activeDocument ? { ...s.activeDocument, fields: updatedFields } : s.activeDocument }))

    // Ethan 抽屉同步（M3 钩子）：ChatInput 通道与 FormFillView 通道的答案都经过这里
    if (field && prev.drawerSyncMode) {
      const updatedDoc: FormDocument = { ...prev.activeDocument, fields: updatedFields }
      const result = formDrawerSyncService.syncAnswer({ ...field, value }, updatedDoc, prev.drawerSyncMode)
      if (result.downgrade) {
        // 连续失败自动降级为仅对话模式，问答主流程不受影响
        set({ drawerSyncMode: 'none', drawerSyncError: '抽屉同步连续失败，已自动切换为仅对话填写' })
      }
    }
  },

  updateFieldDeletePlaceholder: (fieldId, deletePlaceholder) =>
    set((s) => {
      if (!s.activeDocument) return s
      const fields = s.activeDocument.fields.map((f) =>
        f.id === fieldId ? { ...f, deletePlaceholder } : f
      )
      return { activeDocument: { ...s.activeDocument, fields } }
    }),

  nextField: () => {
    const { activeDocument } = get()
    if (!activeDocument || activeDocument.fields.length === 0) return
    const nextIdx = Math.min(activeDocument.currentFieldIndex + 1, activeDocument.fields.length - 1)
    set({ activeDocument: { ...activeDocument, currentFieldIndex: nextIdx } })
  },

  prevField: () => {
    const { activeDocument } = get()
    if (!activeDocument || activeDocument.fields.length === 0) return
    const prevIdx = Math.max(activeDocument.currentFieldIndex - 1, 0)
    set({ activeDocument: { ...activeDocument, currentFieldIndex: prevIdx } })
  },

  setStatus: (status) =>
    set((s) => {
      if (!s.activeDocument) return s
      return { activeDocument: { ...s.activeDocument, status } }
    }),

  setFillMethod: (method) => set({ fillMethod: method }),

  endSession: (filledFilePath?: string) => {
    // 从后往前找到最后一条 Agent 消息，如果是过时的填写提示则替换为结束语
    const state = useChatStore.getState()
    const msgs = state.messages
    const stalePatterns = ['请在下方勾选', '开始填写', '提取到', '待填项']
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'agent' && stalePatterns.some(p => msgs[i].content.includes(p))) {
        const endMsg = filledFilePath
          ? `✅ 表单填写会话已结束。填写后的文件已保存至：\n${filledFilePath}\n\n如需继续填写，请重新发送文档。`
          : '已手动退出，项目终止'
        state.updateMessageByIndex(i, endMsg)
        break
      }
    }
    set({
      activeDocument: null,
      isFormFillingSession: false,
      formFillPhase: null,
      selectedFieldIds: [],
      availableFiles: [],
      isProcessing: false,
      drawerSyncMode: null,
      drawerSyncError: null,
    })
    // 清空抽屉同步服务的内部状态（文档模型/目标 sheet/失败计数）
    formDrawerSyncService.resetSession()
    // 关键修复：退出表单填写会话时，必须把 activeAgentId 重置为 null
    // 否则后续消息会因 activeAgentId 仍为 'form-filler' 而被错误路由到 Ethan
    state.setActiveAgent(null)
  },
}))
