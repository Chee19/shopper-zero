import { useEffect, useMemo, useState } from "react"
import { animate, motion, useMotionValue, useMotionValueEvent } from "framer-motion"
import { PASS, projectedStep, reach, type WorkflowNode } from "../model"
import { ArrowDownRight, ArrowUpRight } from "./Icons"

export function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
  const motionValue = useMotionValue(0)
  const [text, setText] = useState(format(0))
  useMotionValueEvent(motionValue, "change", (latest) => setText(format(latest)))
  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.7, ease: [0.2, 0.8, 0.2, 1] })
    return () => controls.stop()
  }, [value, motionValue])
  return <>{text}</>
}

function seeded(label: string, count: number): number[] {
  let h = 7
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  return Array.from({ length: count }, () => {
    h = (h * 1103515245 + 12345) >>> 0
    return 22 + (h % 60)
  })
}

export function KpiTile({
  value,
  format,
  label,
  good,
  suffix,
  onClick,
}: {
  value: number
  format: (value: number) => string
  label: string
  good: boolean
  suffix?: string
  onClick?: () => void
}) {
  const bars = useMemo(() => seeded(label, 20), [label])
  return (
    <button type="button" className="kpi" onClick={onClick} disabled={!onClick}>
      <div className="kpi-text">
        <div className="kpi-num">
          <strong>
            <CountUp value={value} format={format} />
            {suffix && <small>{suffix}</small>}
          </strong>
          <span className={good ? "trend ok" : "trend bad"}>
            {good ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          </span>
        </div>
        <span className="kpi-label">{label}</span>
      </div>
      <span className={good ? "kpi-bars ok" : "kpi-bars bad"} aria-hidden="true">
        {bars.map((height, i) => (
          <i
            key={i}
            className={i >= bars.length - 3 && i !== bars.length - 2 ? "hot" : ""}
            style={{ height: `${i >= bars.length - 3 ? Math.min(100, height + 30) : height}%` }}
          />
        ))}
      </span>
    </button>
  )
}

export function StepBars({ nodes }: { nodes: WorkflowNode[] }) {
  return (
    <div className="stepbars">
      <div className="axis" aria-hidden="true">
        <span>100</span>
        <span>75</span>
        <span>50</span>
        <span>25</span>
      </div>
      <div className="stepbars-plot" role="img" aria-label="Grok score and a person's score at each step">
        {nodes.map((node, i) => (
          <div key={node.id} className="sb-group" title={`${node.label}: Grok ${node.score}%, person ${node.human}%`}>
            <motion.i
              className="human"
              initial={{ height: 0 }}
              animate={{ height: `${node.human}%` }}
              transition={{ delay: i * 0.03, duration: 0.5 }}
            />
            <motion.i
              className={node.ok ? "grok ok" : "grok bad"}
              initial={{ height: 0 }}
              animate={{ height: `${node.score}%` }}
              transition={{ delay: 0.1 + i * 0.03, duration: 0.5 }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function linePath(values: number[]): string {
  const step = 400 / (values.length - 1)
  return values
    .map((value, i) => {
      const x = i * step
      const y = 120 - (value / 100) * 110 - 5
      if (i === 0) return `M${x} ${y}`
      const px = (i - 1) * step
      const py = 120 - (values[i - 1] / 100) * 110 - 5
      const cx = (px + x) / 2
      return `C${cx} ${py} ${cx} ${y} ${x} ${y}`
    })
    .join(" ")
}

export function ReachChart({ nodes }: { nodes: WorkflowNode[] }) {
  const now = reach(nodes)
  const after = reach(nodes.map((node) => ({ score: projectedStep(node.score) })))
  const stopIndex = Math.max(0, now.findIndex((value) => value < PASS))
  const stopValue = now[stopIndex]
  return (
    <div className="reach">
      <div className="axis" aria-hidden="true">
        <span>100%</span>
        <span>50%</span>
        <span>0%</span>
      </div>
      <div className="reach-plot" role="img" aria-label="How far Grok gets through the purchase, now and after the fix">
        <svg viewBox="0 0 400 120" preserveAspectRatio="none">
          {[5, 60, 115].map((y) => (
            <line key={y} x1="0" x2="400" y1={y} y2={y} className="grid" />
          ))}
          <motion.path
            d={linePath(after)}
            className="after"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
          />
          <motion.path
            d={linePath(now)}
            className="now"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, delay: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </svg>
        <span
          className="reach-dot"
          style={{
            left: `${(stopIndex / (nodes.length - 1)) * 100}%`,
            top: `${((120 - (stopValue / 100) * 110 - 5) / 120) * 100}%`,
          }}
        />
      </div>
      <div className="legend">
        <span>
          <i className="swatch now" /> Now
        </span>
        <span>
          <i className="swatch after" /> After the fix
        </span>
      </div>
    </div>
  )
}
