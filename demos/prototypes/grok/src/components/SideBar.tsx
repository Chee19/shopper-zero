export type VersionId =
  | "fix"
  | "trip"
  | "overview"
  | "workflow"
  | "product"
  | "checkout"
  | "payment"
  | "full"

const PLAIN: { id: VersionId; label: string }[] = [
  { id: "fix", label: "What to fix" },
  { id: "trip", label: "Shop trip" },
]

const TECHNICAL: { id: VersionId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "workflow", label: "Workflow" },
  { id: "product", label: "Product" },
  { id: "checkout", label: "Checkout" },
  { id: "payment", label: "Payment" },
  { id: "full", label: "Full report" },
]

export function SideBar({
  version,
  technical,
  hasReport,
  onVersion,
  onTechnical,
}: {
  version: VersionId
  technical: boolean
  hasReport: boolean
  onVersion: (version: VersionId) => void
  onTechnical: (technical: boolean) => void
}) {
  const pages = technical ? TECHNICAL : PLAIN

  return (
    <aside className="nav-side">
      <p className="nav-label">Pages</p>
      <nav className="nav-pages" aria-label="Pages">
        {pages.map((item) => (
          <button
            key={item.id}
            type="button"
            className={hasReport && version === item.id ? "on" : ""}
            disabled={!hasReport}
            aria-current={hasReport && version === item.id ? "page" : undefined}
            onClick={() => onVersion(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="nav-settings">
        <p className="nav-label">Settings</p>
        <div className="nav-mode" role="group" aria-label="Non technical or technical">
          <button type="button" className={technical ? "" : "on"} onClick={() => onTechnical(false)}>
            Non technical
          </button>
          <button type="button" className={technical ? "on" : ""} onClick={() => onTechnical(true)}>
            Technical
          </button>
        </div>
      </div>
    </aside>
  )
}
