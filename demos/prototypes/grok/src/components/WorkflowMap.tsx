import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  MAP_H,
  MAP_W,
  edgePath,
  edgePoints,
  type EdgePoint,
  type FocusGroup,
  type WorkflowNode,
} from "../model"
import { CloseIcon, FitIcon, MinusIcon, PlusIcon } from "./Icons"
import { GrokBot, StepMark, Tile } from "./Tile"

const pop = { type: "spring" as const, stiffness: 320, damping: 20, mass: 0.8 }

function midpoint(points: EdgePoint[]): EdgePoint {
  if (points.length === 2) {
    return [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2]
  }
  return [points[1][0], (points[1][1] + points[2][1]) / 2]
}

function useFitScale(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(MAP_W)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => setWidth(node.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  const narrow = width < 560
  const base = Math.min(1, Math.max(0.55, (width - 24) / MAP_W))
  return { base, narrow }
}

export function WorkflowMap({
  nodes,
  revealed,
  tokenIndex,
  selectedId,
  dimGroup,
  onSelect,
  onFix,
  showToken = true,
}: {
  nodes: WorkflowNode[]
  revealed: number
  tokenIndex: number | null
  selectedId: string | null
  dimGroup: FocusGroup | null
  onSelect: (id: string | null) => void
  onFix?: (node: WorkflowNode) => void
  showToken?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const { base, narrow } = useFitScale(wrapRef)
  const [zoom, setZoom] = useState(1)
  const scale = base * zoom
  const [showFix, setShowFix] = useState(false)
  const prevToken = useRef<number | null>(null)

  useEffect(() => {
    setShowFix(false)
  }, [selectedId])

  const token = tokenIndex != null ? nodes[tokenIndex] : null
  const fromEdge =
    token && tokenIndex != null && tokenIndex > 0 && prevToken.current === tokenIndex - 1
  const tokenFrames: EdgePoint[] = token
    ? fromEdge
      ? [...edgePoints(nodes[tokenIndex! - 1], token), [token.x, token.y - 56]]
      : [[token.x, token.y - 56]]
    : []

  useEffect(() => {
    prevToken.current = tokenIndex
  }, [tokenIndex])

  const selected = nodes.find((node) => node.id === selectedId) ?? null
  const selectedIndex = selected ? nodes.indexOf(selected) : -1
  const popLeft = selected ? selected.x > MAP_W * 0.62 : false

  return (
    <div className="map-wrap" ref={wrapRef}>
      <div
        className={narrow || zoom > 1 ? "map-scroll pan" : "map-scroll"}
        style={{ height: MAP_H * scale }}
      >
        <div
          className="map-stage"
          style={{ width: MAP_W * scale, height: MAP_H * scale }}
        >
          <div
            className="map-inner"
            style={{ width: MAP_W, height: MAP_H, transform: `scale(${scale})` }}
            onClick={(event) => {
              if (event.target === event.currentTarget) onSelect(null)
            }}
          >
            <svg className="map-lines" width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
              {nodes.slice(1).map((node, k) => {
                const from = nodes[k]
                const points = edgePoints(from, node)
                const d = edgePath(points)
                return <path key={`ghost-${node.id}`} d={d} className="ghost-line" />
              })}
              {nodes.slice(1).map((node, k) => {
                const index = k + 1
                if (index >= revealed) return null
                const from = nodes[k]
                const points = edgePoints(from, node)
                const d = edgePath(points)
                const [mx, my] = midpoint(points)
                const tone = node.ok ? "ok" : "bad"
                const dim = dimGroup && node.group !== dimGroup ? " dim" : ""
                return (
                  <g key={node.id} className={`edge ${tone}${dim}`}>
                    <motion.path
                      d={d}
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                    />
                    <motion.g
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.35, duration: 0.2 }}
                    >
                      <circle cx={points[0][0]} cy={points[0][1]} r="4" />
                      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="4" />
                      <rect className="chip" x={mx - 8} y={my - 6} width="16" height="12" rx="3" />
                      <path className="chip-mark" d={`M${mx - 4} ${my - 2} h3 M${mx - 4} ${my + 2} h3 M${mx + 1} ${my - 2} v4`} />
                    </motion.g>
                  </g>
                )
              })}
            </svg>

            {nodes.map((node, index) => {
              if (index >= revealed) {
                return (
                  <span
                    key={node.id}
                    className="node-ghost"
                    style={{ left: node.x, top: node.y }}
                    aria-hidden="true"
                  />
                )
              }
              const dim = dimGroup && node.group !== dimGroup
              const isSelected = node.id === selectedId
              return (
                <motion.button
                  key={node.id}
                  type="button"
                  className={`node ${node.kind}${isSelected ? " selected" : ""}${dim ? " dim" : ""}`}
                  style={{ left: node.x, top: node.y }}
                  initial={{ scale: 0.86, opacity: 0 }}
                  animate={{ scale: 1, opacity: dim ? 0.35 : 1 }}
                  transition={pop}
                  whileHover={{ y: -3 }}
                  onClick={() => onSelect(isSelected ? null : node.id)}
                  aria-label={`${node.label}, ${node.score}%, ${node.ok ? "working" : "needs work"}`}
                  aria-pressed={isSelected}
                >
                  <span className="node-halo" aria-hidden="true" />
                  <Tile id={node.id} ok={node.ok} />
                  <span className={`node-label ${node.ok ? "ok" : "bad"}`}>
                    <b>{node.score}%</b>
                    {node.label}
                  </span>
                </motion.button>
              )
            })}

            {showToken && token && (
              <motion.span
                key={`token-${tokenIndex}`}
                className="token"
                initial={{ x: tokenFrames[0][0], y: tokenFrames[0][1] }}
                animate={{
                  x: tokenFrames.map((point) => point[0]),
                  y: tokenFrames.map((point) => point[1]),
                }}
                transition={
                  tokenFrames.length > 1
                    ? { duration: 0.62, ease: "easeInOut" }
                    : { type: "spring", stiffness: 260, damping: 22 }
                }
              >
                <GrokBot />
              </motion.span>
            )}
          </div>

          <AnimatePresence>
            {selected && (
              <motion.div
                key={selected.id}
                className={popLeft ? "map-pop left" : "map-pop"}
                style={{
                  left: (selected.x + (popLeft ? -62 : 62)) * scale,
                  top: Math.max(8, (selected.y - 70) * scale),
                }}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                transition={pop}
              >
                <button
                  type="button"
                  className="pop-close"
                  aria-label="Close"
                  onClick={() => onSelect(null)}
                >
                  <CloseIcon />
                </button>
                <div className="pop-head">
                  <span className={`pop-thumb ${selected.ok ? "ok" : "bad"}`} aria-hidden="true">
                    <StepMark id={selected.id} />
                  </span>
                  <div>
                    <strong>
                      {selected.label} <em>- №{String(selectedIndex + 1).padStart(2, "0")}</em>
                    </strong>
                    <span className={selected.ok ? "status ok" : "status bad"}>
                      <i /> {selected.ok ? "Working" : "Needs work"}
                    </span>
                  </div>
                </div>
                <Readiness score={selected.score} ok={selected.ok} />
                {showFix && <p className="pop-fix">{selected.fix}</p>}
                <button
                  type="button"
                  className="pop-btn"
                  onClick={() => {
                    if (showFix && onFix) onFix(selected)
                    else setShowFix(true)
                  }}
                >
                  {showFix && onFix ? "Fix this for €79" : selected.ok ? "See what works" : "See the fix"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="zoom">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.6, z + 0.2))}>
          <PlusIcon />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.7, z - 0.2))}>
          <MinusIcon />
        </button>
        <button type="button" aria-label="Fit to screen" onClick={() => setZoom(1)}>
          <FitIcon />
        </button>
      </div>
    </div>
  )
}

export function Readiness({ score, ok, label = "Readiness" }: { score: number; ok: boolean; label?: string }) {
  return (
    <div className="readiness">
      <div className="ready-top">
        <span>{label}</span>
        <em style={{ left: `min(calc(100% - 14px), max(${score}%, calc(${(label.length * 0.56).toFixed(2)}em + 22px)))` }}>
          {score}%
        </em>
      </div>
      <div className={ok ? "ready-track ok" : "ready-track bad"}>
        <motion.i
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        />
        <motion.b
          initial={{ left: 0 }}
          animate={{ left: `${score}%` }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </div>
    </div>
  )
}
