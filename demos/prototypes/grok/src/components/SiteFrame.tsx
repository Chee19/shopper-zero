import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { shotUrl, type ShopUrl, type WorkflowNode } from "../model"
import { Favicon } from "./Favicon"

const press = { type: "spring" as const, stiffness: 520, damping: 18, mass: 0.45 }
const travel = { type: "spring" as const, stiffness: 280, damping: 24, mass: 0.7 }
const pop = { type: "spring" as const, stiffness: 460, damping: 16, mass: 0.55 }

/** One stop per step, in shopping order, walking down a normal shop page. */
const ROUTE: Record<string, { x: number; y: number }> = {
  open: { x: 8, y: 11 },
  read: { x: 26, y: 36 },
  find: { x: 64, y: 11 },
  price: { x: 16, y: 48 },
  stock: { x: 14, y: 78 },
  options: { x: 32, y: 78 },
  cart: { x: 50, y: 78 },
  review: { x: 68, y: 78 },
  shipping: { x: 84, y: 78 },
  form: { x: 91, y: 11 },
  pay: { x: 84, y: 18 },
  confirmed: { x: 76, y: 24 },
}

type Aim = { x: number; y: number; clicking: boolean }

function stopFor(node: WorkflowNode) {
  return ROUTE[node.id] ?? { x: 50, y: 50 }
}

export function SiteFrame({
  shop,
  node,
  nodes,
  progress,
  generating,
}: {
  shop: ShopUrl
  node: WorkflowNode | null
  nodes: WorkflowNode[]
  progress: number
  generating: boolean
}) {
  const [shot, setShot] = useState<"loading" | "in" | "off">("loading")
  const [rev, setRev] = useState(0)
  const [aim, setAim] = useState<Aim>({ x: 16, y: 16, clicking: false })
  const [note, setNote] = useState<string | null>(null)
  const [clickId, setClickId] = useState(0)
  const [badClick, setBadClick] = useState(false)

  useEffect(() => {
    const retry = window.setTimeout(() => setRev((value) => (value === 0 ? 1 : value)), 3800)
    return () => window.clearTimeout(retry)
  }, [shop.href])

  useEffect(() => {
    if (!generating) return
    setNote(null)
    setAim({ x: 16, y: 16, clicking: false })
  }, [generating, shop.href])

  useEffect(() => {
    if (!generating || !node) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const spot = stopFor(node)
    const stuck = node.checks.find((check) => check.status === "error")
    setAim({ x: spot.x, y: spot.y, clicking: false })
    setNote(node.scanText)
    const clickAt = reduce ? 0 : 320
    const click = window.setTimeout(() => {
      setAim({ x: spot.x, y: spot.y, clicking: true })
      setBadClick(Boolean(stuck))
      setClickId((value) => value + 1)
      setNote(stuck ? `${node.label}. ${stuck.detail}` : node.label)
    }, clickAt)
    const release = window.setTimeout(() => setAim((value) => ({ ...value, clicking: false })), clickAt + 160)
    return () => {
      window.clearTimeout(click)
      window.clearTimeout(release)
    }
  }, [generating, node])

  useEffect(() => {
    if (generating || !node) return
    const spot = stopFor(node)
    setAim({ x: spot.x, y: spot.y, clicking: false })
    setNote(node.ok ? node.label : `${node.label}. ${node.fix}`)
  }, [generating, node])

  const stops = nodes.map((item, index) => ({ ...stopFor(item), node: item, index }))
  const trail = stops.map((stop) => `${stop.x},${stop.y}`).join(" ")
  const labeled = new Set(
    nodes
      .filter((item) => !item.ok)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map((item) => item.id),
  )

  return (
    <div className="site-frame">
      <div className="chrome">
        <span className="traffic" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="omni">
          <Favicon host={shop.host} />
          <span>{shop.href}</span>
        </div>
      </div>
      <div className="viewport">
        {shot !== "in" && (
          <div className="skeleton" aria-hidden={shot !== "off"}>
            <div className="sk-hero">
              <Favicon host={shop.host} />
              <strong>{shop.host}</strong>
              <span>
                {shot === "off"
                  ? "This shop blocks picture tools. The check still ran."
                  : "Loading the real shop page…"}
              </span>
            </div>
          </div>
        )}
        {shot !== "off" && (
          <img
            className={shot === "in" ? "shot in" : "shot"}
            alt={`Screenshot of ${shop.host}`}
            src={`${shotUrl(shop.href)}&r=${rev}`}
            onLoad={() => setShot("in")}
            onError={() => {
              if (rev < 2) setRev((value) => value + 1)
              else setShot("off")
            }}
          />
        )}
        {stops.length > 1 && (
          <svg className="trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={trail} />
          </svg>
        )}
        <AnimatePresence>
          {stops.map((stop) => (
            <motion.div
              key={stop.node.id}
              className={`${stop.node.ok ? "stop ok" : "stop bad"}${stop.x > 72 ? " flip" : ""}`}
              style={{ left: `${stop.x}%`, top: `${stop.y}%` }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={pop}
            >
              <b>{stop.index + 1}</b>
              {!generating && labeled.has(stop.node.id) && <em>{stop.node.label}</em>}
            </motion.div>
          ))}
        </AnimatePresence>
        {(generating || node) && (
          <motion.div
            className={`${aim.clicking ? "cursor down" : "cursor"}${aim.x > 68 ? " flip" : ""}`}
            animate={{ left: `${aim.x}%`, top: `${aim.y}%`, scale: aim.clicking ? 0.86 : 1 }}
            transition={{ left: travel, top: travel, scale: press }}
            aria-hidden="true"
          >
            {generating && note && <span className="journey-note">{note}</span>}
            <AnimatePresence>
              {aim.clicking && (
                <motion.span
                  key={clickId}
                  className={badClick ? "ripple bad" : "ripple ok"}
                  initial={{ scale: 0.2, opacity: 0.9 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
                />
              )}
            </AnimatePresence>
            <Pointer />
          </motion.div>
        )}
        <div className="hud">
          <div>
            <strong>
              {generating
                ? note ?? node?.scanText ?? `Opening ${shop.host}`
                : `Grok walked through ${shop.host}`}
            </strong>
            <span>
              {generating
                ? `Step ${Math.max(nodes.length, 1)} · ${progress}% of a purchase`
                : `${progress}% of a purchase`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Pointer() {
  return (
    <svg className="pointer" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M5 3.2 L5 18.4 L9.1 14.6 L12.4 21.2 L15.2 19.8 L11.8 13.2 L17.6 13.2 Z"
        fill="white"
        stroke="#1E1E1E"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}
