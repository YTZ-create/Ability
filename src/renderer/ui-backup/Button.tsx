import React from 'react'

const variants: Record<string, string> = {
  primary: 'bg-brutal-yellow hover:bg-brutal-orange',
  secondary: 'bg-white hover:bg-brutal-cream',
  danger: 'bg-brutal-pink hover:bg-brutal-orange text-white',
}

const sizes: Record<string, string> = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-5 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

export const Button: React.FC<{
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  className?: string
  icon?: React.ReactNode
}> = ({ children, onClick, variant = 'primary', size = 'md', disabled, className = '', icon }) => (
  <button onClick={onClick} disabled={disabled}
    className={`btn-brutal inline-flex items-center gap-2 ${sizes[size] || sizes.md} ${variants[variant] || variants.primary} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
    {icon && <span className="flex-shrink-0">{icon}</span>}{children}
  </button>
)
