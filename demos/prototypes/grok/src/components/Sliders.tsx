import { formatEuro, formatInt } from "../model"

export function Sliders({
  visits,
  aov,
  onVisits,
  onAov,
}: {
  visits: number
  aov: number
  onVisits: (value: number) => void
  onAov: (value: number) => void
}) {
  return (
    <div className="sliders">
      <label htmlFor="visits">
        <span>Visits per month</span>
        <strong>{formatInt(visits)}</strong>
        <input
          id="visits"
          type="range"
          min={100}
          max={200000}
          step={100}
          value={visits}
          onChange={(event) => onVisits(Number(event.target.value))}
        />
      </label>
      <label htmlFor="aov">
        <span>Average sale</span>
        <strong>{formatEuro(aov)}</strong>
        <input
          id="aov"
          type="range"
          min={8}
          max={400}
          step={1}
          value={aov}
          onChange={(event) => onAov(Number(event.target.value))}
        />
      </label>
    </div>
  )
}
