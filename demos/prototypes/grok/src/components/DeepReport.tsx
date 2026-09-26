import { motion } from "framer-motion"
import {
  formatEuro,
  formatInt,
  formatOrders,
  formatShare,
  passes,
  solutionSentence,
  type Money,
  type Report,
  type ScoredStep,
} from "../model"
import { Formula } from "./Formula"
import { Sliders } from "./Sliders"

const pop = { type: "spring" as const, stiffness: 300, damping: 15, mass: 0.8 }

function Dual({ step }: { step: ScoredStep }) {
  return (
    <div className="dual">
      {step.human != null && (
        <div className="lane">
          <i>
            <b className="human" style={{ width: `${step.human}%` }} />
          </i>
          <em>{step.human}%</em>
        </div>
      )}
      <div className="lane">
        <i>
          <b
            className={passes(step.score) ? "grok ok" : "grok bad"}
            style={{ width: `${step.score}%` }}
          />
        </i>
        <em>{step.score}%</em>
      </div>
    </div>
  )
}

export function DeepReport({
  report,
  money,
  visits,
  aov,
  onVisits,
  onAov,
  onBuy,
}: {
  report: Report
  money: Money
  visits: number
  aov: number
  onVisits: (value: number) => void
  onAov: (value: number) => void
  onBuy: () => void
}) {
  const tone = report.overall >= 64 ? "ok" : "bad"

  return (
    <section className="deep">
      <div className="fix-head">
        <h2>Full report</h2>
        <p>{solutionSentence(report.worst)}</p>
      </div>

      <div className="deep-grid">
        <aside className="glass">
          <header className="glass-head">
            <h2>Every step</h2>
            <p>Green means Grok can do it. Red means that part is weak.</p>
          </header>
          <ol className="step-list">
            {report.steps.map((step) => {
              const ok = passes(step.score)
              return (
                <li key={step.id}>
                  <div className="step-row">
                    <span className={ok ? "dot ok" : "dot bad"} />
                    <strong>{step.label}</strong>
                    <em>{step.score}%</em>
                    <span className={ok ? "pill ok" : "pill bad"}>{ok ? "Done" : "Blocked"}</span>
                  </div>
                  {!ok && <p>{step.fix}</p>}
                </li>
              )
            })}
          </ol>
        </aside>

        <div className="deep-main">
          <article className="card">
            <h2>Grok versus a person</h2>
            <div className="versus">
              <div>
                <span>A person</span>
                <strong className="ok">{report.humanOverall}%</strong>
                <em>of a purchase finished</em>
                <div className="wide">
                  <i className="ok" style={{ width: `${report.humanOverall}%` }} />
                </div>
              </div>
              <div>
                <span>Grok</span>
                <strong className={tone}>{report.overall}%</strong>
                <em>of a purchase finished</em>
                <div className="wide">
                  <i className={tone} style={{ width: `${report.overall}%` }} />
                </div>
              </div>
            </div>
          </article>

          <article className="card">
            <h2>This month</h2>
            <ul className="funnel">
              <li>
                <b>{formatOrders(money.agentShoppers)}</b>
                <span>AI shoppers</span>
              </li>
              <li>
                <b>{formatOrders(money.wouldBuy)}</b>
                <span>Would buy</span>
              </li>
              <li>
                <b>{formatOrders(money.grokFinishes)}</b>
                <span>Grok finishes</span>
              </li>
              <li>
                <b>{formatOrders(money.lostOrders)}</b>
                <span>Left behind</span>
              </li>
            </ul>
            <p className="formula">
              {formatShare(money.agentShare)} of visits come with an AI shopper. A person buys on{" "}
              {formatShare(money.humanRate)} of visits. Grok only finishes the part your pages allow.
            </p>
          </article>

          <article className="card year">
            <div>
              <span>Over a year</span>
              <strong>{formatEuro(money.yearlyLoss)}</strong>
              <em>does not come in, at these numbers</em>
            </div>
            <div>
              <span>After the fix</span>
              <strong className="ok">{formatEuro(money.lift * 12)}</strong>
              <em>more across the year, about 70% of the gap</em>
            </div>
          </article>
        </div>
      </div>

      <article className="card">
        <h2>Drop-off at each step</h2>
        <div className="legend">
          <span>
            <i className="swatch human" /> People
          </span>
          <span>
            <i className="swatch grok" /> Grok
          </span>
        </div>
        <ol className="dropoff">
          {report.steps.map((step) => (
            <li key={step.id}>
              <span>{step.label}</span>
              <Dual step={step} />
            </li>
          ))}
        </ol>
      </article>

      <article className="card">
        <h2>Parts of the site</h2>
        <ul className="areas">
          {report.areas.map((area) => (
            <li key={area.id} className={passes(area.score) ? "ok" : "bad"}>
              <strong>{area.score}%</strong>
              <span>{area.label}</span>
              <i>
                <b style={{ width: `${area.score}%` }} />
              </i>
            </li>
          ))}
        </ul>
      </article>

      <div className="bottom-cards">
        <article className="stat-card">
          <header>
            <span className="dot bad" />
            <h2>Sales left behind</h2>
          </header>
          <p className="stat-num bad">
            {formatEuro(money.lostMoney)} <small>/ month</small>
          </p>
          <p className="stat-sub">
            About {formatOrders(money.lostOrders)} sales · {formatInt(money.visits)} visits
          </p>
          <Formula money={money} />
        </article>
        <article className="stat-card">
          <header>
            <span className="dot ok" />
            <h2>After the fix</h2>
          </header>
          <p className="stat-num ok">
            {formatEuro(money.lift)} <small>/ month</small>
          </p>
          <p className="stat-sub">About 70% of the missed sales, if the weak steps get fixed.</p>
          <Sliders visits={visits} aov={aov} onVisits={onVisits} onAov={onAov} />
        </article>
      </div>

      <div className="cta-wrap">
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
      </div>
    </section>
  )
}
