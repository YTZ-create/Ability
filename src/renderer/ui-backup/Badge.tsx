import React from 'react'

export const Badge: React.FC<{
  children: React.ReactNode
  color?: string
  textColor?: string
  className?: string
}> = ({ children, color = '#FFD440', textColor = '#141111', className = '' }) => (
  <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold border-2 border-brutal-black ${className}`}
    style={{ backgroundColor: color, color: textColor }}>{children}</span>
)
