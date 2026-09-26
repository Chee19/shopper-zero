import { useEffect, useMemo, useState, type FormEvent } from "react"
import { motion } from "framer-motion"
import {
  PRICE_EUR,
  formatEuro,
  passes,
  paybackLabel,
  projectedScore,
  projectedStep,
  solutionSentence,
  type Money,
  type Report,
  type ShopUrl,
} from "../model"
import { BackIcon } from "./Icons"
import { WorkflowMap } from "./WorkflowMap"

const pop = { type: "spring" as const, stiffness: 300, damping: 15, mass: 0.8 }

type CardForm = {
  name: string
  email: string
  card: string
  expiry: string
  cvc: string
}

const emptyForm: CardForm = { name: "", email: "", card: "", expiry: "", cvc: "" }

function formatCard(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 16)
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim()
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

function validate(form: CardForm): string | null {
  if (form.name.trim().length < 2) return "Add the name on the card."
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return "Add an email so the setup has somewhere to go."
  }
  const digits = form.card.replace(/\D/g, "")
  if (digits.length < 12 || digits.length > 16) {
    return "Add the card number. Any test number works in this demo."
  }
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(form.expiry)) return "Add the expiry as MM/YY."
  if (!/^\d{3,4}$/.test(form.cvc)) return "Add the 3-digit code."
  return null
}

export function Checkout({
  shop,
  report,
  money,
  onBack,
  onPaid,
}: {
  shop: ShopUrl
  report: Report
  money: Money
  onBack: () => void
  onPaid: () => void
}) {
  const [form, setForm] = useState<CardForm>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const next = projectedScore(report.overall)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const problem = validate(form)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setPaying(true)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    await new Promise((resolve) => window.setTimeout(resolve, reduce ? 0 : 700))
    onPaid()
  }

  return (
    <section className="pay">
      <div className="offer">
        <button type="button" className="round back-round" aria-label="Back to the report" onClick={onBack}>
          <BackIcon />
        </button>
        <p className="eyebrow">The fix for {shop.host}</p>
        <h1>Add about {formatEuro(money.lift)} a month.</h1>
        <p className="price-line">
          <strong>€{PRICE_EUR}</strong> once
        </p>
        <p className="lede">{paybackLabel(money.paybackDays)}</p>
        <p className="section-copy">{solutionSentence(report.worst)}</p>
        <ul className="gets">
          {report.worst.map((step) => (
            <li key={step.id}>
              <span className="dot ok" />
              {step.gets}
            </li>
          ))}
        </ul>
        <div className="ba">
          <div>
            <span>Now</span>
            <strong className="bad">{report.overall}%</strong>
            <em>{formatEuro(money.lostMoney)} missed / month</em>
          </div>
          <div>
            <span>After</span>
            <strong className="ok">{next}%</strong>
            <em>{formatEuro(money.lift)} more / month</em>
          </div>
        </div>
        <p className="quiet">
          The fix is built to bring back about 70% of those missed sales. The rest still depends
          on people wanting the product.
        </p>
      </div>

      <form className="pay-card" autoComplete="off" onSubmit={submit}>
        <h2>Buy the fix</h2>
        <label>
          Name
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Your name"
            autoComplete="off"
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="you@shop.com"
            autoComplete="off"
          />
        </label>
        <label>
          Card
          <input
            inputMode="numeric"
            value={form.card}
            onChange={(event) => setForm({ ...form, card: formatCard(event.target.value) })}
            placeholder="4242 4242 4242 4242"
            autoComplete="off"
          />
        </label>
        <div className="split">
          <label>
            Expiry
            <input
              inputMode="numeric"
              value={form.expiry}
              onChange={(event) => setForm({ ...form, expiry: formatExpiry(event.target.value) })}
              placeholder="MM/YY"
              autoComplete="off"
            />
          </label>
          <label>
            CVC
            <input
              inputMode="numeric"
              value={form.cvc}
              onChange={(event) =>
                setForm({ ...form, cvc: event.target.value.replace(/\D/g, "").slice(0, 4) })
              }
              placeholder="123"
              autoComplete="off"
            />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <motion.button
          className="btn dark xl"
          type="submit"
          disabled={paying}
          whileHover={paying ? undefined : { scale: 1.02 }}
          whileTap={paying ? undefined : { scale: 0.98 }}
          transition={pop}
        >
          <span>{paying ? "Setting it up…" : `Pay €${PRICE_EUR}`}</span>
          <strong>Add about {formatEuro(money.lift)} / month</strong>
        </motion.button>
        <p className="quiet center">Demo checkout. Nothing is charged.</p>
      </form>
    </section>
  )
}

export function DoneView({
  shop,
  report,
  money,
  onRestart,
}: {
  shop: ShopUrl
  report: Report
  money: Money
  onRestart: () => void
}) {
  const next = projectedScore(report.overall)
  const nodes = useMemo(
    () =>
      report.nodes.map((node) => {
        const score = projectedStep(node.score)
        return { ...node, score, ok: passes(score) }
      }),
    [report.nodes],
  )
  const [revealed, setRevealed] = useState(0)

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) {
      setRevealed(nodes.length)
      return
    }
    const timer = window.setInterval(() => {
      setRevealed((value) => {
        if (value >= nodes.length) {
          window.clearInterval(timer)
          return value
        }
        return value + 1
      })
    }, 170)
    return () => window.clearInterval(timer)
  }, [nodes.length])

  return (
    <motion.section
      className="done"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 26, mass: 0.8 }}
    >
      <div className="done-head">
        <div>
          <p className="eyebrow">{shop.host} can take the next order</p>
          <h1>About {formatEuro(money.lift)} more each month.</h1>
          <p className="lede">
            Grok can now finish {next}% of a purchase, up from {report.overall}%.
          </p>
        </div>
        <div className="ba">
          <div>
            <span>Before</span>
            <strong className="bad">{report.overall}%</strong>
            <em>{report.working} of {nodes.length} steps working</em>
          </div>
          <div>
            <span>After</span>
            <strong className="ok">{next}%</strong>
            <em>
              {nodes.filter((node) => node.ok).length} of {nodes.length} steps working
            </em>
          </div>
        </div>
      </div>
      <div className="map-card">
        <WorkflowMap
          nodes={nodes}
          revealed={revealed}
          tokenIndex={revealed > 0 ? revealed - 1 : null}
          showToken={false}
          selectedId={null}
          dimGroup={null}
          onSelect={() => {}}
        />
      </div>
      <p className="quiet center">Demo checkout. Nothing was charged.</p>
      <motion.button
        type="button"
        className="btn dark"
        onClick={onRestart}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.98 }}
        transition={pop}
      >
        Check another shop
      </motion.button>
    </motion.section>
  )
}
