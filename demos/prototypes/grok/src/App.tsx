import { useEffect, useMemo, useState, type ReactNode } from "react"
import { AnimatePresence, MotionConfig, motion } from "framer-motion"
import {
  buildReport,
  computeMoney,
  parseShopUrl,
  presets,
  type Report,
  type ShopUrl,
} from "./model"
import { Checkout, DoneView } from "./components/Checkout"
import { Favicon } from "./components/Favicon"
import { Paste } from "./components/Paste"
import { SideBar, type VersionId } from "./components/SideBar"
import { TopBar } from "./components/TopBar"
import { Workspace } from "./components/Workspace"

type Stage = "paste" | "report" | "pay" | "done"

const pageSpring = { type: "spring" as const, stiffness: 300, damping: 28, mass: 0.8 }

function Frame({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="frame"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={pageSpring}
    >
      {children}
    </motion.div>
  )
}

export function App() {
  const [stage, setStage] = useState<Stage>("paste")
  const [value, setValue] = useState("")
  const [bigger, setBigger] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shop, setShop] = useState<ShopUrl | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [generated, setGenerated] = useState(false)
  const [scanId, setScanId] = useState(0)
  const [visits, setVisits] = useState(1200)
  const [aov, setAov] = useState(48)
  const [version, setVersion] = useState<VersionId>("fix")

  const money = useMemo(() => {
    if (!report) return null
    return computeMoney({ visits, aov, bigger, overall: report.overall })
  }, [report, visits, aov, bigger])

  useEffect(() => {
    document.title =
      shop && stage !== "paste"
        ? `Grok Buy — ${shop.host}`
        : "Grok Buy — Can Grok buy from your shop?"
  }, [shop, stage])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [stage])

  function applyBigger(next: boolean) {
    const preset = presets(next)
    setBigger(next)
    setVisits(preset.visits)
    setAov(preset.aov)
  }

  function start() {
    const next = parseShopUrl(value)
    if (!next) {
      setError("Add a real shop link, like northwind.shop")
      return
    }
    setError(null)
    setShop(next)
    setReport(buildReport(next.host))
    applyBigger(bigger)
    setGenerated(false)
    setScanId((id) => id + 1)
    setStage("report")
  }

  const wide = stage !== "paste"

  return (
    <MotionConfig reducedMotion="user">
      <div className="canvas app-shell">
        <SideBar
          version={version}
          technical={bigger}
          hasReport={Boolean(shop && report)}
          onVersion={setVersion}
          onTechnical={applyBigger}
        />
        <div className="app-main">
        <div className={wide ? "screen wide" : "screen"}>
          {stage !== "report" && (
            <TopBar
              onBrand={() => {
                if (stage !== "paste" && shop && report) setStage("report")
                else window.scrollTo({ top: 0, behavior: "smooth" })
              }}
              end={
                shop && stage !== "paste" ? (
                  <div className="hostchip">
                    <Favicon host={shop.host} />
                    <span>{shop.host}</span>
                    {bigger && <em>Technical</em>}
                  </div>
                ) : null
              }
            />
          )}

          <AnimatePresence mode="wait">
            {stage === "paste" && (
              <Frame key="paste">
                <Paste
                  value={value}
                  error={error}
                  onChange={(next) => {
                    setValue(next)
                    if (error) setError(null)
                  }}
                  onStart={start}
                />
              </Frame>
            )}
            {stage === "report" && shop && report && money && (
              <Frame key={`report-${scanId}`}>
                <Workspace
                  shop={shop}
                  report={report}
                  money={money}
                  bigger={bigger}
                  visits={visits}
                  aov={aov}
                  alreadyGenerated={generated}
                  onVisits={setVisits}
                  onAov={setAov}
                  onBuy={() => setStage("pay")}
                  onNewShop={() => setStage("paste")}
                  onGenerated={() => setGenerated(true)}
                  version={version}
                  onVersion={setVersion}
                />
              </Frame>
            )}
            {stage === "pay" && shop && report && money && (
              <Frame key="pay">
                <Checkout
                  shop={shop}
                  report={report}
                  money={money}
                  onBack={() => setStage("report")}
                  onPaid={() => setStage("done")}
                />
              </Frame>
            )}
            {stage === "done" && shop && report && money && (
              <Frame key="done">
                <DoneView shop={shop} report={report} money={money} onRestart={() => setStage("paste")} />
              </Frame>
            )}
          </AnimatePresence>
        </div>
        </div>
      </div>
    </MotionConfig>
  )
}
