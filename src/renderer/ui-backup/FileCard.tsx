import React from 'react'
import { File, Folder, Clock } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { getFileIcon, getFileColor, formatFileSize, formatTime } from '../../utils/formatters'
import type { FileEntry } from '../../api/neutralino'

export const FileCard: React.FC<{ file: FileEntry; isDetail?: boolean; onClick?: () => void }> = ({ file, isDetail, onClick }) => {
  const color = file.isDirectory ? '#BBAFE6' : getFileColor(file.ext)

  if (isDetail) {
    return (
      <div className="p-4 border-b-2 border-brutal-black bg-white">
        <div className="flex items-center gap-2 mb-2">
          {file.isDirectory ? <Folder size={20} color={color} /> : <File size={20} color={color} />}
          <span className="font-bold text-sm">{file.name}</span>
          <Badge color={color}>{file.isDirectory ? 'DIR' : getFileIcon(file.ext)}</Badge>
        </div>
        <div className="text-xs text-black/70 space-y-1">
          <div>路径: {file.relativePath}</div>
          {!file.isDirectory && <><div>大小: {formatFileSize(file.size)}</div>
          <div className="flex items-center gap-1"><Clock size={10} />修改: {formatTime(file.modifiedAt)}</div></>}
          {file.isDirectory && file.children && <div>包含: {file.children.length} 项</div>}
        </div>
      </div>
    )
  }

  return (
    <div onClick={onClick} className="file-card">
      <div className="flex items-center gap-2">
        {file.isDirectory ? <Folder size={16} color={color} /> : <File size={16} color={color} />}
        <span className="text-sm font-bold truncate flex-1">{file.name}</span>
        <Badge color={color} className="text-[9px]">{file.isDirectory ? 'DIR' : getFileIcon(file.ext)}</Badge>
      </div>
      {!file.isDirectory && <div className="text-[10px] text-black/70 font-mono mt-1">{formatFileSize(file.size)}</div>}
    </div>
  )
}
