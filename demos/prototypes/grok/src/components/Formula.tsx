import { formatEuro, formatInt, formatShare, type Money } from "../model"

export function Formula({ money }: { money: Money }) {
  return (
    <p className="formula">
      {formatInt(money.visits)} visits × {formatShare(money.agentShare)} with an AI shopper ×{" "}
      {formatShare(money.humanRate)} who buy × the {money.gapPercent}% Grok cannot finish ×{" "}
      {formatEuro(money.aov)}
    </p>
  )
}
