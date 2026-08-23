import React from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useFolderStore } from '../../stores/folderStore'
import { useSettingsStore } from '../../stores/settingsStore'

export const StatusBar: React.FC = () => {
  const isStreaming = useChatStore((s) => s.isStreaming)
  const activeFolder = useFolderStore((s) => {
    const id = s.activeFolderId
    return id ? s.folders.find((f) => f.id === id) : null
  })
  const providers = useSettingsStore((s) => s.providers)
  const configuredCount = providers.filter((p) => p.hasKey).length

  return (
    <div className="h-7 border-t-2 border-brutal-black bg-brutal-black text-brutal-cream flex items-center justify-between px-3 text-[10px] font-mono flex-shrink-0">
      <div className="flex items-center gap-3">
        {isStreaming ? (
          <span className="flex items-center gap-1.5 text-brutal-yellow font-bold">
            <span className="w-1.5 h-1.5 rounded-sm bg-brutal-yellow animate-pulse" />
            Agent 思考中...
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-white/80">
            <span className="w-1.5 h-1.5 rounded-sm bg-brutal-lime" />
            就绪
          </span>
        )}
        {activeFolder && (
          <>
            <span className="text-white/70">|</span>
            <span className="text-white/80 truncate max-w-[300px]">{activeFolder.path}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {configuredCount > 0 ? (
          <span className="text-brutal-lime flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-sm bg-brutal-lime" />
            API: {configuredCount}/{providers.length} 厂商已配置
          </span>
        ) : (
          <button onClick={() => useSettingsStore.getState().setShowSettings(true)}
            className="text-brutal-yellow hover:text-white flex items-center gap-1.5 cursor-pointer">
            <span className="w-1.5 h-1.5 rounded-sm bg-brutal-yellow animate-pulse" />
            点击配置 API Key
          </button>
        )}
        <span className="text-white/70">|</span>
        <span className="text-white/80">Windows</span>
      </div>
    </div>
  )
}
