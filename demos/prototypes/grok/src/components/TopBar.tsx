import type { ReactNode } from "react"
import { Mark } from "./Mark"

export function TopBar({
  center,
  end,
  onBrand,
}: {
  center?: ReactNode
  end?: ReactNode
  onBrand?: () => void
}) {
  const brand = (
    <>
      <Mark />
      <span>
        Grok Buy
        <small>Agent checkout</small>
      </span>
    </>
  )
  return (
    <header className="top">
      {onBrand ? (
        <button type="button" className="brand" onClick={onBrand}>
          {brand}
        </button>
      ) : (
        <div className="brand">{brand}</div>
      )}
      <div className="center">{center}</div>
      <div className="end">{end}</div>
    </header>
  )
}
