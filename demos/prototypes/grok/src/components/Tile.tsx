const STEPS: Record<string, { word: string; icon: IconName }> = {
  open: { word: "Shop", icon: "shop" },
  read: { word: "Page", icon: "page" },
  find: { word: "Find", icon: "find" },
  price: { word: "Price", icon: "price" },
  stock: { word: "Stock", icon: "stock" },
  options: { word: "Size", icon: "size" },
  cart: { word: "Cart", icon: "cart" },
  review: { word: "Review", icon: "review" },
  shipping: { word: "Ship", icon: "ship" },
  form: { word: "Form", icon: "form" },
  pay: { word: "Pay", icon: "pay" },
  confirmed: { word: "Done", icon: "done" },
}

type IconName =
  | "shop"
  | "page"
  | "find"
  | "price"
  | "stock"
  | "size"
  | "cart"
  | "review"
  | "ship"
  | "form"
  | "pay"
  | "done"

function StepIcon({ name }: { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  }
  if (name === "shop") {
    return (
      <svg {...common}>
        <path d="M4 10h16v9H4z" />
        <path d="M3 10l2.2-5h13.6L21 10" />
        <path d="M10 19v-5h4v5" />
      </svg>
    )
  }
  if (name === "page") {
    return (
      <svg {...common}>
        <path d="M7 3.5h7l4 4V20.5H7z" />
        <path d="M14 3.5V8h4" />
        <path d="M10 12h5M10 15.5h5" />
      </svg>
    )
  }
  if (name === "find") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6" />
        <path d="M15.5 15.5L20 20" />
      </svg>
    )
  }
  if (name === "price") {
    return (
      <svg {...common}>
        <path d="M4 12l8-8h7v7l-8 8z" />
        <circle cx="15.2" cy="8.8" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (name === "stock") {
    return (
      <svg {...common}>
        <path d="M4 8l8-4 8 4-8 4z" />
        <path d="M4 8v8l8 4 8-4V8" />
        <path d="M12 12v8" />
      </svg>
    )
  }
  if (name === "size") {
    return (
      <svg {...common}>
        <path d="M5 7h6v10H5zM13 10h6v7h-6z" />
      </svg>
    )
  }
  if (name === "cart") {
    return (
      <svg {...common}>
        <path d="M4 6h2l2.2 9h9.2l1.8-6H8" />
        <circle cx="10" cy="19" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="17" cy="19" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (name === "review") {
    return (
      <svg {...common}>
        <path d="M8 6h11M8 12h11M8 18h11" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    )
  }
  if (name === "ship") {
    return (
      <svg {...common}>
        <path d="M3 15h13V8H8L5 12H3z" />
        <path d="M16 11h3l2 4h-5z" />
        <circle cx="7.5" cy="18" r="1.4" />
        <circle cx="17" cy="18" r="1.4" />
      </svg>
    )
  }
  if (name === "form") {
    return (
      <svg {...common}>
        <path d="M8 4h8v16H8z" />
        <path d="M11 9h3M11 13h3M11 17h2" />
      </svg>
    )
  }
  if (name === "pay") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12.2l2.3 2.3 4.7-5" />
    </svg>
  )
}

export function StepMark({ id }: { id: string }) {
  const step = STEPS[id] ?? { word: "Step", icon: "shop" as const }
  return <StepIcon name={step.icon} />
}

export function Tile({ id, ok }: { id: string; ok: boolean }) {
  const step = STEPS[id] ?? { word: "Step", icon: "shop" as const }
  return (
    <span className={`tile3d step ${ok ? "ok" : "bad"}`} aria-hidden="true">
      <span className="tface">
        <StepIcon name={step.icon} />
        <b>{step.word}</b>
      </span>
    </span>
  )
}

export function GrokBot() {
  return (
    <span className="grokbot">Grok</span>
  )
}
