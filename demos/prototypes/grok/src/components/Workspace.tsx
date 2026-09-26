import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { AnimatePresence, LayoutGroup, motion } from "framer-motion"
import {
  computeMoney,
  formatEuro,
  formatOrders,
  partialScore,
  solutionSentence,
  type FocusGroup,
  type Money,
  type Report,
  type ShopUrl,
  type WorkflowNode,
} from "../model"
import { KpiTile, CountUp, ReachChart, StepBars } from "./Charts"
import { DeepReport } from "./DeepReport"
import { Favicon } from "./Favicon"
import { Formula } from "./Formula"
import {
  ArrowUpRight,
  BackIcon,
  BellIcon,
  BrowserIcon,
  RefreshIcon,
  SearchIcon,
} from "./Icons"
import { SiteFrame } from "./SiteFrame"
import { Sliders } from "./Sliders"
import { StepPanel } from "./StepPanel"
import type { VersionId } from "./SideBar"
import { TopBar } from "./TopBar"
import { Readiness, WorkflowMap } from "./WorkflowMap"

type Tab = "overview" | "workflow" | FocusGroup | "full"

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "workflow", label: "Workflow" },
  { id: "product", label: "Product" },
  { id: "checkout", label: "Checkout" },
  { id: "payment", label: "Payment" },
  { id: "full", label: "Full report" },
]

const STEP_MS = 1080
const pop = { type: "spring" as const, stiffness: 300, damping: 15, mass: 0.8 }
const settle = { type: "spring" as const, stiffness: 260, damping: 28, mass: 0.9 }

export function Workspace({
  shop,
  report,
  money,
  bigger,
  visits,
  aov,
  alreadyGenerated,
  onVisits,
  onAov,
  onBuy,
  onNewShop,
  onGenerated,
  version,
  onVersion,
}: {
  shop: ShopUrl
  report: Report
  money: Money
  bigger: boolean
  visits: number
  aov: number
  alreadyGenerated: boolean
  onVisits: (value: number) => void
  onAov: (value: number) => void
  onBuy: () => void
  onNewShop: () => void
  onGenerated: () => void
  version: VersionId
  onVersion: (version: VersionId) => void
}) {
  const nodes = report.nodes
  const worst = report.worst[0]
  const [generating, setGenerating] = useState(!alreadyGenerated)
  const [revealed, setRevealed] = useState(alreadyGenerated ? nodes.length : 0)
  const [tab, setTab] = useState<Tab>(alreadyGenerated && bigger ? "full" : "overview")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(alreadyGenerated ? worst.id : null)
  const [showSite, setShowSite] = useState(false)
  const [searchAsk, setSearchAsk] = useState(0)
  const [run, setRun] = useState(0)
  const slidersRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (generating || !bigger) return
    const next: Tab = version === "fix" ? "overview" : version === "trip" ? "workflow" : version
    if (TABS.some((item) => item.id === next)) setTab(next)
  }, [version, bigger, generating])

  useEffect(() => {
    if (!generating) return
    let cancelled = false
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
    async function play() {
      setRevealed(0)
      setSelectedId(null)
      await sleep(reduce ? 50 : 650)
      for (let i = 0; i < nodes.length; i++) {
        if (cancelled) return
        setRevealed(i + 1)
        setOpenId(nodes[i].id)
        await sleep(reduce ? 60 : STEP_MS)
      }
      await sleep(reduce ? 60 : 520)
      if (cancelled) return
      setGenerating(false)
      setShowSite(false)
      setOpenId(worst.id)
      setSelectedId(worst.id)
      if (bigger) onVersion("full")
      onGenerated()
    }
    void play()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, run])

  const shown = nodes.slice(0, revealed)
  const partial = generating ? partialScore(shown) : report.overall
  const working = shown.filter((node) => node.ok).length
  const liveMoney = useMemo(
    () => (generating ? computeMoney({ visits, aov, bigger, overall: partial || 100 }) : money),
    [generating, visits, aov, bigger, partial, money],
  )
  const failing = shown.find((node) => !node.ok) ?? null
  const active = generating ? nodes[Math.max(0, revealed - 1)] : null
  const firstFail = nodes.findIndex((node) => !node.ok)
  const tokenIndex = generating
    ? revealed > 0
      ? revealed - 1
      : null
    : firstFail >= 0
      ? firstFail
      : nodes.length - 1
  const split = generating || showSite
  const dimGroup: FocusGroup | null =
    tab === "product" || tab === "checkout" || tab === "payment" ? tab : null
  const panelNodes = dimGroup ? nodes.filter((node) => node.group === dimGroup) : nodes
  const panelRevealed = dimGroup
    ? shown.filter((node) => node.group === dimGroup).length
    : revealed

  function pickTab(next: Tab) {
    if (generating) return
    setTab(next)
    onVersion(next)
    if (next === "product" || next === "checkout" || next === "payment") {
      const inGroup = nodes.filter((node) => node.group === next)
      const target = [...inGroup].sort((a, b) => a.score - b.score)[0]
      if (target) {
        setSelectedId(target.id)
        setOpenId(target.id)
      }
    }
  }

  function openStep(id: string) {
    const node = nodes.find((item) => item.id === id)
    if (!node || generating) return
    setTab(node.group)
    onVersion(node.group)
    setSelectedId(id)
    setOpenId(id)
  }

  function select(id: string | null) {
    setSelectedId(id)
    if (id) setOpenId(id)
  }

  function replay() {
    setGenerating(true)
    setTab("overview")
    setRun((value) => value + 1)
  }

  function scrollToSliders() {
    slidersRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  if (!bigger) {
    const showTrip = generating || version === "trip" || version === "workflow"
    return (
      <section className="workspace simple">
        <TopBar
          onBrand={onNewShop}
          end={
            <button type="button" className="round" aria-label="Scan again" disabled={generating} onClick={replay}>
              <RefreshIcon />
            </button>
          }
        />
        <div className="simple-layout">
          {showTrip ? (
            <>
              <SiteFrame
                shop={shop}
                node={active ?? (generating ? null : worst)}
                nodes={generating ? shown : nodes}
                progress={partial}
                generating={generating}
              />
              {generating ? (
                <p className="simple-live">
                  Grok is walking through the shop, trying to buy. Step {Math.max(revealed, 1)} of {nodes.length}.
                </p>
              ) : (
                <SimpleResult report={report} money={money} onBuy={onBuy} />
              )}
            </>
          ) : (
            <SimpleResult report={report} money={money} onBuy={onBuy} />
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="workspace">
      <TopBar
        onBrand={() => {
          if (!generating) pickTab("overview")
        }}
        end={
          <div className="icon-row">
            <button
              type="button"
              className="round"
              aria-label="Search the steps"
              disabled={generating}
              onClick={() => {
                setTab("workflow")
                setSearchAsk((value) => value + 1)
              }}
            >
              <SearchIcon />
            </button>
            <button
              type="button"
              className="round"
              aria-label={failing ? `Open the step that needs work: ${failing.label}` : "No problems yet"}
              disabled={!failing || generating}
              onClick={() => failing && openStep(failing.id)}
            >
              <BellIcon />
              {failing && <span className="alert-dot" />}
            </button>
            <button
              type="button"
              className={showSite ? "round avatar active" : "round avatar"}
              aria-label={showSite ? `Open ${shop.host}` : `Show ${shop.host} beside the report`}
              onClick={() => {
                if (showSite) window.open(shop.href, "_blank", "noopener,noreferrer")
                else setShowSite(true)
              }}
            >
              <Favicon host={shop.host} />
            </button>
          </div>
        }
      />

      <div className="ws-head">
        <button type="button" className="round" aria-label="Back to the start" onClick={onNewShop}>
          <BackIcon />
        </button>
        <div className="ws-title">
          <h1>{shop.host}</h1>
          <p>
            {generating ? "Grok is shopping now" : "Scanned"} · {shop.href}
          </p>
        </div>
        <div className="kpis">
          <KpiTile
            value={partial}
            format={(v) => `${Math.round(v)}%`}
            label="Grok finishes"
            good={partial >= 64}
            onClick={() => pickTab("full")}
          />
          <KpiTile
            value={working}
            format={(v) => String(Math.round(v))}
            suffix={`/${nodes.length}`}
            label="Steps working"
            good={working * 2 >= Math.max(1, shown.length)}
            onClick={() => pickTab("workflow")}
          />
          <KpiTile
            value={liveMoney.lostMoney}
            format={(v) => formatEuro(v)}
            label="Lost per month"
            good={false}
            onClick={() => {
              if (generating) return
              pickTab("overview")
              window.setTimeout(scrollToSliders, 60)
            }}
          />
        </div>
        <div className="ws-controls">
          <button
            type="button"
            className={showSite || generating ? "round active" : "round"}
            aria-label={showSite ? "Hide my site" : "Show my site"}
            aria-pressed={split}
            disabled={generating}
            onClick={() => setShowSite((value) => !value)}
          >
            <BrowserIcon />
          </button>
          <button
            type="button"
            className="round"
            aria-label="Scan again"
            disabled={generating}
            onClick={replay}
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      <LayoutGroup>
        <div className={split ? "ws-body split" : "ws-body"}>
          <AnimatePresence initial={false}>
            {split && (
              <motion.div
                key="site"
                className="ws-site"
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={settle}
              >
                <p className="side-label">
                  <i className="dot ok" /> Your site
                </p>
                <SiteFrame
                  shop={shop}
                  node={active ?? (generating ? null : worst)}
                  nodes={generating ? shown : nodes}
                  progress={partial}
                  generating={generating}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="ws-main">
            {generating ? (
              <ScanView
                revealed={revealed}
                nodes={nodes}
                shown={shown}
                partial={partial}
                panelNodes={panelNodes}
                panelRevealed={panelRevealed}
                selectedId={selectedId}
                openId={openId}
                tokenIndex={tokenIndex}
                dimGroup={dimGroup}
                lost={liveMoney.lostMoney}
                finishes={liveMoney.grokFinishes}
                wouldBuy={liveMoney.wouldBuy}
                onSelect={select}
                onOpen={setOpenId}
                onNumbers={() => {
                  if (generating) return
                  pickTab("overview")
                  window.setTimeout(scrollToSliders, 60)
                }}
                onFull={() => pickTab("full")}
              />
            ) : tab === "overview" ? (
              <OverviewPage
                report={report}
                money={money}
                shown={shown}
                partial={partial}
                visits={visits}
                aov={aov}
                slidersRef={slidersRef}
                onVisits={onVisits}
                onAov={onAov}
                onOpenStep={openStep}
                onNumbers={scrollToSliders}
                onWorkflow={() => pickTab("workflow")}
                onFull={() => pickTab("full")}
                onBuy={onBuy}
              />
            ) : tab === "workflow" ? (
              <div className="workflow-page">
                <div className="ws-grid">
                  <StepPanel
                    nodes={nodes}
                    revealed={nodes.length}
                    selectedId={selectedId}
                    openId={openId}
                    generating={false}
                    startSearching={searchAsk > 0}
                    searchAsk={searchAsk}
                    onSelect={select}
                    onOpen={setOpenId}
                  />
                  <div className="map-card">
                    <WorkflowMap
                      nodes={nodes}
                      revealed={nodes.length}
                      tokenIndex={tokenIndex}
                      showToken={false}
                      selectedId={selectedId}
                      dimGroup={null}
                      onSelect={select}
                      onFix={onBuy}
                    />
                  </div>
                </div>
              </div>
            ) : tab === "full" ? (
              <DeepReport
                report={report}
                money={money}
                visits={visits}
                aov={aov}
                onVisits={onVisits}
                onAov={onAov}
                onBuy={onBuy}
              />
            ) : (
              <GroupPage
                group={tab}
                nodes={nodes.filter((node) => node.group === tab)}
                openId={openId}
                onOpen={setOpenId}
                onMap={(id) => {
                  setSelectedId(id)
                  setOpenId(id)
                  setTab("workflow")
                }}
                onBuy={onBuy}
              />
            )}
          </div>
        </div>
      </LayoutGroup>
    </section>
  )
}

const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24, mass: 0.8 } },
}

const GROUP_COPY: Record<FocusGroup, { title: string; text: string }> = {
  product: {
    title: "Product",
    text: "Grok looks for something to buy, then reads the price, the stock, and the options.",
  },
  checkout: {
    title: "Checkout",
    text: "Grok goes from the cart to the form. Each extra page or popup is a sale that stops.",
  },
  payment: {
    title: "Payment",
    text: "Grok has to see the total, then a normal way to pay, then a confirmation.",
  },
}

function ScanView({
  revealed,
  nodes,
  shown,
  partial,
  panelNodes,
  panelRevealed,
  selectedId,
  openId,
  tokenIndex,
  dimGroup,
  lost,
  finishes,
  wouldBuy,
  onSelect,
  onOpen,
  onNumbers,
  onFull,
}: {
  revealed: number
  nodes: WorkflowNode[]
  shown: WorkflowNode[]
  partial: number
  panelNodes: WorkflowNode[]
  panelRevealed: number
  selectedId: string | null
  openId: string | null
  tokenIndex: number | null
  dimGroup: FocusGroup | null
  lost: number
  finishes: number
  wouldBuy: number
  onSelect: (id: string | null) => void
  onOpen: (id: string | null) => void
  onNumbers: () => void
  onFull: () => void
}) {
  return (
    <>
      <p className="side-label report-label">
        <i className="dot live" /> Building the report · step {revealed} of {nodes.length}
      </p>
      <div className="ws-grid">
        <StepPanel
          nodes={panelNodes}
          revealed={panelRevealed}
          selectedId={selectedId}
          openId={openId}
          generating
          onSelect={(id) => onSelect(id)}
          onOpen={onOpen}
        />
        <div className="ws-map-col">
          <div className="map-card">
            <WorkflowMap
              nodes={nodes}
              revealed={revealed}
              tokenIndex={tokenIndex}
              selectedId={null}
              dimGroup={dimGroup}
              onSelect={onSelect}
              onFix={() => undefined}
            />
          </div>
          <div className="glass-cards">
            <article className="gcard">
              <header>
                <h3>Sales left behind</h3>
              </header>
              <div className="gcard-row">
                <p className="gnum">
                  <button type="button" className="trend bad" aria-label="Jump to the lost sales" onClick={onNumbers}>
                    <ArrowUpRight size={11} />
                  </button>
                  <strong>
                    <CountUp value={lost} format={formatEuro} />
                  </strong>
                  <small>/ month</small>
                </p>
                <div className="gmeter">
                  <Readiness score={70} ok label="Fix brings back" />
                </div>
              </div>
              <StepBars nodes={shown} />
            </article>
            <article className="gcard">
              <header>
                <h3>Orders Grok finishes</h3>
              </header>
              <div className="gcard-row">
                <p className="gnum">
                  <button
                    type="button"
                    className={partial >= 64 ? "trend ok" : "trend bad"}
                    aria-label="Open the full report"
                    onClick={onFull}
                  >
                    <ArrowUpRight size={11} />
                  </button>
                  <strong>
                    <CountUp value={finishes} format={formatOrders} />
                  </strong>
                  <small>/ month of {formatOrders(wouldBuy)}</small>
                </p>
                <div className="gmeter">
                  <Readiness score={partial} ok={partial >= 64} label="Grok finishes" />
                </div>
              </div>
              {shown.length > 1 ? <ReachChart nodes={shown} /> : <div className="chart-wait" />}
            </article>
          </div>
        </div>
      </div>
    </>
  )
}

function OverviewPage({
  report,
  money,
  shown,
  partial,
  visits,
  aov,
  slidersRef,
  onVisits,
  onAov,
  onOpenStep,
  onNumbers,
  onWorkflow,
  onFull,
  onBuy,
}: {
  report: Report
  money: Money
  shown: WorkflowNode[]
  partial: number
  visits: number
  aov: number
  slidersRef: RefObject<HTMLDivElement | null>
  onVisits: (value: number) => void
  onAov: (value: number) => void
  onOpenStep: (id: string) => void
  onNumbers: () => void
  onWorkflow: () => void
  onFull: () => void
  onBuy: () => void
}) {
  return (
    <motion.div className="page" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
      <motion.header className="page-head" variants={rise}>
        <div>
          <h2>What Grok could not finish</h2>
          <p>
            {solutionSentence(report.worst)} Fix those and about {formatEuro(money.lift)} a month comes back.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={onWorkflow}>
            See the workflow
          </button>
          <button type="button" className="btn dark" onClick={onBuy}>
            Fix this
          </button>
        </div>
      </motion.header>

      <motion.div className="glass-cards stack" variants={rise}>
        <article className="gcard">
          <header>
            <h3>Sales left behind</h3>
          </header>
          <div className="gcard-row">
            <p className="gnum">
              <button type="button" className="trend bad" aria-label="Jump to the lost sales" onClick={onNumbers}>
                <ArrowUpRight size={11} />
              </button>
              <strong>
                <CountUp value={money.lostMoney} format={formatEuro} />
              </strong>
              <small>/ month</small>
            </p>
            <div className="gmeter">
              <Readiness score={70} ok label="Fix brings back" />
            </div>
          </div>
          <StepBars nodes={shown} />
        </article>
        <article className="gcard">
          <header>
            <h3>Orders Grok finishes</h3>
          </header>
          <div className="gcard-row">
            <p className="gnum">
              <button
                type="button"
                className={partial >= 64 ? "trend ok" : "trend bad"}
                aria-label="Open the full report"
                onClick={onFull}
              >
                <ArrowUpRight size={11} />
              </button>
              <strong>
                <CountUp value={money.grokFinishes} format={formatOrders} />
              </strong>
              <small>/ month of {formatOrders(money.wouldBuy)}</small>
            </p>
            <div className="gmeter">
              <Readiness score={partial} ok={partial >= 64} label="Grok finishes" />
            </div>
          </div>
          <ReachChart nodes={shown} />
        </article>
      </motion.div>

      <motion.div className="page-links" variants={rise}>
        <button type="button" onClick={onNumbers}>
          Change visits and sale size
        </button>
        <button type="button" onClick={onFull}>
          Open the full report
        </button>
      </motion.div>

      <motion.div className="fix-head" variants={rise}>
        <h2>Three changes that bring those sales back</h2>
        <p>Each one opens the part of the shop it belongs to.</p>
      </motion.div>
      <ol className="fix-cards">
        {report.worst.map((node) => (
          <motion.li key={node.id} variants={rise}>
            <button type="button" onClick={() => onOpenStep(node.id)}>
              <span className="fix-top">
                <span className="pill error">{node.score}%</span>
                <strong>{node.label}</strong>
              </span>
              <span className="fix-text">{node.fix}</span>
            </button>
          </motion.li>
        ))}
      </ol>

      <motion.div className="money-strip" variants={rise} ref={slidersRef}>
        <div>
          <p className="money-kicker">Your numbers</p>
          <p className="money-line">
            About <strong>{formatEuro(money.lostMoney)}</strong> a month does not happen.
          </p>
          <Formula money={money} />
        </div>
        <Sliders visits={visits} aov={aov} onVisits={onVisits} onAov={onAov} />
      </motion.div>

      <motion.div className="cta-wrap" variants={rise}>
        <motion.button
          type="button"
          className="btn dark xl"
          onClick={onBuy}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={pop}
        >
          <span>Fix this</span>
          <strong>Add about {formatEuro(money.lift)} / month</strong>
        </motion.button>
        <p className="quiet center">€79 once. The next screen shows what you get.</p>
      </motion.div>
    </motion.div>
  )
}

function GroupPage({
  group,
  nodes,
  openId,
  onOpen,
  onMap,
  onBuy,
}: {
  group: FocusGroup
  nodes: WorkflowNode[]
  openId: string | null
  onOpen: (id: string | null) => void
  onMap: (id: string) => void
  onBuy: () => void
}) {
  const copy = GROUP_COPY[group]
  const weak = nodes.filter((node) => !node.ok).length
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2>{copy.title}</h2>
          <p>
            {copy.text} {weak === 0 ? "Every step here works." : `${weak} of ${nodes.length} need work.`}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn dark" onClick={onBuy} disabled={weak === 0}>
            Fix this part
          </button>
        </div>
      </header>
      <ol className="step-grid">
        {nodes.map((node) => {
          const open = openId === node.id
          return (
            <li key={node.id} className={`op-card page-step${open ? " selected" : ""}`}>
              <div className="op-top">
                <button type="button" className="op-main" onClick={() => onOpen(open ? null : node.id)}>
                  <span className="op-name">
                    <strong>{node.label}</strong>
                    <span className={node.ok ? "status ok" : "status bad"}>
                      <i /> {node.ok ? "Working" : "Needs work"} · {node.score}%
                    </span>
                  </span>
                </button>
              </div>
              <Readiness score={node.score} ok={node.ok} />
              <p className="fix-text">{node.ok ? node.gets : node.fix}</p>
              {open && (
                <table className="plain-checks">
                  <tbody>
                    {node.checks.map((check) => (
                      <tr key={check.label}>
                        <td>
                          <span className="check-name">
                            <i className={`dot ${check.status === "done" ? "ok" : check.status === "error" ? "bad" : "skip"}`} />
                            {check.label}
                          </span>
                        </td>
                        <td>{check.detail}</td>
                        <td>
                          <span className={`pill ${check.status}`}>
                            {check.status === "done" ? "Done" : check.status === "error" ? "Error" : "Skip"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="page-links">
                <button type="button" onClick={() => onOpen(open ? null : node.id)}>
                  {open ? "Hide the checks" : "Show the checks"}
                </button>
                <button type="button" onClick={() => onMap(node.id)}>
                  Show on the map
                </button>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function SimpleResult({ report, money, onBuy }: { report: Report; money: Money; onBuy: () => void }) {
  const stuck = report.nodes.filter((node) => !node.ok)
  return (
    <div className="simple-result">
      <p className="eyebrow">What happened</p>
      <h2>
        {report.working} of {report.nodes.length} steps worked.
      </h2>
      <div className="simple-stats">
        <p>
          <strong>{report.overall}%</strong>
          <span>Grok finishes a purchase</span>
        </p>
        <p>
          <strong>{report.humanOverall}%</strong>
          <span>A person finishes</span>
        </p>
        <p>
          <strong>{formatEuro(money.lostMoney)}</strong>
          <span>Missed each month</span>
        </p>
      </div>
      <p className="simple-score">
        {stuck.length === 0
          ? "Every step worked. There is nothing to fix."
          : solutionSentence(report.worst)}
      </p>
      <h3>What to do</h3>
      <ol className="simple-fixes">
        {report.worst.map((node, index) => (
          <li key={node.id}>
            <strong>
              {index + 1}. {node.label} · {node.score}%
            </strong>
            <span>{node.fix}</span>
          </li>
        ))}
      </ol>
      <p className="simple-money">
        Fixing these brings back about <strong>{formatEuro(money.lift)}</strong> a month.
      </p>
      <button type="button" className="btn dark xl" onClick={onBuy}>
        <span>Fix this</span>
        <strong>Add about {formatEuro(money.lift)} a month</strong>
      </button>
      <p className="quiet">€79 once. This is a demo. Nothing is charged.</p>
    </div>
  )
}
