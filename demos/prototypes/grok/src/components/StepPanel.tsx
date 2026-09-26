import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import type { CheckStatus, WorkflowNode } from "../model"
import { ChevronIcon, PinIcon, SearchIcon, StepGlyph } from "./Icons"
import { Readiness } from "./WorkflowMap"

type Filter = "all" | "working" | "needs"

const pillText: Record<CheckStatus, string> = { done: "Done", error: "Error", skip: "Skip" }
const spring = { type: "spring" as const, stiffness: 300, damping: 26, mass: 0.8 }

export function StepPanel({
  nodes,
  revealed,
  selectedId,
  openId,
  generating,
  startSearching = false,
  searchAsk = 0,
  onSelect,
  onOpen,
}: {
  nodes: WorkflowNode[]
  revealed: number
  selectedId: string | null
  openId: string | null
  generating: boolean
  startSearching?: boolean
  searchAsk?: number
  onSelect: (id: string) => void
  onOpen: (id: string | null) => void
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)

  const shown = nodes.slice(0, revealed)
  const working = shown.filter((node) => node.ok).length
  const needs = shown.length - working
  const visible = shown.filter((node) => {
    if (filter === "working" && !node.ok) return false
    if (filter === "needs" && node.ok) return false
    if (query && !node.label.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  useEffect(() => {
    if (!selectedId || !listRef.current) return
    const list = listRef.current
    const card = list.querySelector<HTMLElement>(`[data-step="${selectedId}"]`)
    if (!card) return
    const top = card.offsetTop - list.offsetTop
    list.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" })
  }, [selectedId])

  useEffect(() => {
    if (!generating || !listRef.current) return
    listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [revealed, generating])

  useEffect(() => {
    if (startSearching) setSearching(true)
  }, [startSearching, searchAsk])

  return (
    <aside className="ops">
      <header className="ops-head">
        <h2>Agent steps</h2>
        <div className="ops-tools">
          <button
            type="button"
            className="round sm"
            aria-label="Search steps"
            aria-pressed={searching}
            onClick={() => setSearching((value) => !value)}
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            className="round sm"
            aria-label="Show where Grok stopped"
            onClick={() => {
              const stop = shown.find((node) => !node.ok)
              if (stop) {
                onSelect(stop.id)
                onOpen(stop.id)
              }
            }}
          >
            <PinIcon />
          </button>
        </div>
      </header>

      {searching && (
        <input
          className="ops-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a step"
          autoFocus
        />
      )}

      <div className="chips" role="group" aria-label="Filter steps">
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All <small>{shown.length}</small>
        </button>
        <button type="button" aria-pressed={filter === "working"} onClick={() => setFilter("working")}>
          <i className="dot ok" /> Working <small>{working}</small>
        </button>
        <button type="button" aria-pressed={filter === "needs"} onClick={() => setFilter("needs")}>
          <i className="dot bad" /> Needs work <small>{needs}</small>
        </button>
      </div>

      <ol className="ops-list" ref={listRef}>
        <AnimatePresence initial={false}>
          {visible.map((node) => {
            const index = nodes.indexOf(node)
            const open = openId === node.id
            return (
              <motion.li
                key={node.id}
                data-step={node.id}
                layout
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={spring}
                className={`op-card${selectedId === node.id ? " selected" : ""}`}
              >
                <div className="op-top">
                  <button type="button" className="op-main" onClick={() => onSelect(node.id)}>
                    <span className="op-icon">
                      <StepGlyph />
                    </span>
                    <span className="op-name">
                      <strong>
                        {node.label} <em>- №{String(index + 1).padStart(2, "0")}</em>
                      </strong>
                      <span className={node.ok ? "status ok" : "status bad"}>
                        <i /> {node.ok ? "Working" : "Needs work"}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="round sm"
                    aria-label={open ? `Hide checks for ${node.label}` : `Show checks for ${node.label}`}
                    aria-expanded={open}
                    onClick={() => onOpen(open ? null : node.id)}
                  >
                    <ChevronIcon open={open} />
                  </button>
                </div>
                <Readiness score={node.score} ok={node.ok} />
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      className="op-table"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                      <table>
                        <thead>
                          <tr>
                            <th>Check</th>
                            <th>Detail</th>
                            <th>Score</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {node.checks.map((check, k) => (
                            <motion.tr
                              key={check.label}
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.12 + k * 0.14, ...spring }}
                            >
                              <td>
                                <span className="check-name">
                                  <i className={`dot ${check.status === "done" ? "ok" : check.status === "error" ? "bad" : "skip"}`} />
                                  {check.label}
                                </span>
                              </td>
                              <td>{check.detail}</td>
                              <td>{check.score == null ? "—" : `${check.score}%`}</td>
                              <td>
                                <span className={`pill ${check.status}`}>{pillText[check.status]}</span>
                              </td>
                            </motion.tr>
                          ))}
                        </tbody>
                      </table>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            )
          })}
        </AnimatePresence>
        {generating && revealed < nodes.length && (
          <li className="op-card skeleton-card" aria-hidden="true">
            <span />
            <span />
          </li>
        )}
        {!generating && visible.length === 0 && (
          <li className="ops-empty">No steps match this filter.</li>
        )}
      </ol>
    </aside>
  )
}
