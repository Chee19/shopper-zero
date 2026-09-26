import { useState } from "react"
import { faviconUrl } from "../model"

export function Favicon({ host }: { host: string }) {
  const [ok, setOk] = useState(true)
  if (!ok) return <span className="favicon fallback" aria-hidden="true" />
  return (
    <img
      className="favicon"
      alt=""
      src={faviconUrl(host)}
      onError={() => setOk(false)}
    />
  )
}
