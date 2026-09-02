import React, { useState, useEffect, useRef } from 'react'

export interface AnalysisStep {
  key: string
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
}

interface AnalysisProgressProps {
  steps: AnalysisStep[]
  fileName: string
  /** 是否正在淡出（全部完成后触发） */
  fadingOut?: boolean
}

const STEP_ICONS: Record<string, string> = {
  done: '✓',
  active: '●',
  pending: '○',
  error: '✗',
}

const STEP_COLORS: Record<string, string> = {
  done: '#141111',
  active: '#FFD440',
  pending: 'rgba(20, 17, 17, 0.3)',
  error: '#E53E3E',
}

// 每步最小显示时间（ms），确保用户能看到逐步推进
const MIN_STEP_DURATION = 400

export const AnalysisProgress: React.FC<AnalysisProgressProps> = ({ steps, fileName, fadingOut }) => {
  const totalSteps = steps.length
  const isComplete = steps.every(s => s.status === 'done')
  const hasError = steps.some(s => s.status === 'error')
  const hasActive = steps.some(s => s.status === 'active')

  // 实际完成数（来自 props）
  const actualDoneCount = steps.filter(s => s.status === 'done').length

  // 视觉进度：从 0 逐步推进，每步至少 MIN_STEP_DURATION
  const [displayedDoneCount, setDisplayedDoneCount] = useState(0)
  const stepTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const lastScheduledRef = useRef(0) // 追踪已调度的数量，防止重复调度

  // 清理定时器
  useEffect(() => {
    return () => {
      stepTimersRef.current.forEach(t => clearTimeout(t))
      stepTimersRef.current.clear()
    }
  }, [])

  // 同步视觉进度到实际进度，但保证每步有最小显示时间
  useEffect(() => {
    const lastScheduled = lastScheduledRef.current
    if (actualDoneCount > lastScheduled) {
      // 只调度尚未调度的步骤
      const newSteps = actualDoneCount - lastScheduled
      for (let i = 1; i <= newSteps; i++) {
        const timer = setTimeout(() => {
          setDisplayedDoneCount(prev => Math.min(prev + 1, totalSteps))
          stepTimersRef.current.delete(timer)
        }, i * MIN_STEP_DURATION)
        stepTimersRef.current.add(timer)
      }
      lastScheduledRef.current = actualDoneCount
    } else if (actualDoneCount < displayedDoneCount) {
      // 不应该发生，但以防万一
      setDisplayedDoneCount(actualDoneCount)
      lastScheduledRef.current = actualDoneCount
    }
  }, [actualDoneCount, totalSteps])

  // 计算平滑的进度百分比
  const progressPercent = Math.round((displayedDoneCount / totalSteps) * 100)

  return (
    <div style={{
      border: '2px solid #141111',
      boxShadow: '3px 3px 0px #141111',
      background: '#fff',
      padding: '0',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      opacity: fadingOut ? 0 : 1,
      transform: fadingOut ? 'translateY(-4px)' : 'translateY(0)',
      transition: 'opacity 0.4s ease-out, transform 0.4s ease-out',
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '2px solid #141111',
        padding: '8px 12px',
        background: hasError ? '#FEE2E2' : (isComplete ? '#FFD440' : '#141111'),
        color: hasError ? '#141111' : (isComplete ? '#141111' : '#FFFAEF'),
        fontWeight: 700,
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        transition: 'background 0.3s ease-out, color 0.3s ease-out',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {!isComplete && !hasError && (
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              background: '#FFD440',
              borderRadius: '50%',
              animation: 'analysisPulse 1s ease-in-out infinite',
            }} />
          )}
          {hasError ? '⚠ 分析出错' : (isComplete ? '✓ 分析完成' : '⟳ 正在分析文档')}
        </span>
        <span style={{ fontSize: '11px', opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>
          {fileName}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: '6px',
        background: '#FFFAEF',
        borderBottom: '1px solid #141111',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progressPercent}%`,
          background: hasError ? '#E53E3E' : '#FFD440',
          transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          zIndex: 1,
        }} />
        {/* 流光效果 */}
        {hasActive && !isComplete && !hasError && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
            animation: 'analysisShimmer 1.5s ease-in-out infinite',
            zIndex: 2,
          }} />
        )}
      </div>

      {/* Steps list */}
      <div style={{ padding: '6px 12px 10px' }}>
        {steps.map((step, index) => {
          // 视觉状态：根据 displayedDoneCount 决定
          const visualStatus: 'pending' | 'active' | 'done' | 'error' = (() => {
            if (step.status === 'error') return 'error'
            if (index < displayedDoneCount) return 'done'
            if (index === displayedDoneCount && hasActive) return 'active'
            return 'pending'
          })()

          return (
            <div
              key={step.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 0',
                fontSize: '12px',
                color: visualStatus === 'pending' ? 'rgba(20, 17, 17, 0.35)' : '#141111',
                fontWeight: visualStatus === 'active' ? 700 : (visualStatus === 'done' ? 600 : 400),
                transition: 'all 0.3s ease-out',
              }}
            >
              {/* Step icon */}
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '18px',
                height: '18px',
                border: `2px solid ${STEP_COLORS[visualStatus]}`,
                background: visualStatus === 'active' ? '#FFD440' : (visualStatus === 'done' ? '#141111' : 'transparent'),
                color: visualStatus === 'done' ? '#FFFAEF' : (visualStatus === 'active' ? '#141111' : STEP_COLORS[visualStatus]),
                fontSize: '10px',
                fontWeight: 700,
                flexShrink: 0,
                transition: 'all 0.3s ease-out',
              }}>
                {STEP_ICONS[visualStatus]}
              </span>

              {/* Step label */}
              <span style={{ flex: 1 }}>
                {step.label}
              </span>

              {/* Step status text */}
              {visualStatus === 'active' && (
                <span style={{
                  fontSize: '10px',
                  color: '#141111',
                  fontWeight: 600,
                  background: '#FFD440',
                  padding: '1px 6px',
                  border: '1px solid #141111',
                  animation: 'statusPulse 1.2s ease-in-out infinite',
                }}>
                  进行中
                </span>
              )}
              {visualStatus === 'done' && (
                <span style={{
                  fontSize: '10px',
                  color: '#141111',
                  fontWeight: 600,
                }}>
                  完成
                </span>
              )}
              {visualStatus === 'error' && (
                <span style={{
                  fontSize: '10px',
                  color: '#E53E3E',
                  fontWeight: 600,
                }}>
                  失败
                </span>
              )}
            </div>
          )
        })}
      </div>

      <style>{`
        @keyframes analysisPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes analysisShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes statusPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  )
}
