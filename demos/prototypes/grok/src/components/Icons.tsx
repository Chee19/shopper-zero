import type { ReactNode } from "react"

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const SearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
)

export const BellIcon = () => (
  <Svg>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Svg>
)

export const UserIcon = () => (
  <Svg>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" />
  </Svg>
)

export const BackIcon = () => (
  <Svg>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Svg>
)

export const ArrowUpRight = ({ size = 12 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </Svg>
)

export const ArrowDownRight = ({ size = 12 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M7 7l10 10" />
    <path d="M17 8v9H8" />
  </Svg>
)

export const SwapIcon = () => (
  <Svg size={16}>
    <path d="M4 8h14l-3-3" />
    <path d="M20 16H6l3 3" />
  </Svg>
)

export const BrowserIcon = () => (
  <Svg>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M3.5 9h17" />
  </Svg>
)

export const LayersIcon = () => (
  <Svg>
    <path d="M12 3.5 20 8l-8 4.5L4 8z" />
    <path d="m4 12 8 4.5L20 12" />
    <path d="m4 16 8 4.5L20 16" />
  </Svg>
)

export const GearIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
  </Svg>
)

export const RefreshIcon = () => (
  <Svg>
    <path d="M19 12a7 7 0 1 1-2.1-5" />
    <path d="M19 4v4h-4" />
  </Svg>
)

export const PinIcon = () => (
  <Svg>
    <path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11z" />
    <circle cx="12" cy="10" r="2.2" />
  </Svg>
)

export const SlidersIcon = () => (
  <Svg size={16}>
    <path d="M7 4v16M12 4v16M17 4v16" />
    <path d="M5 9h4M10 15h4M15 8h4" />
  </Svg>
)

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Svg size={16}>
    <path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
  </Svg>
)

export const PlusIcon = () => (
  <Svg size={16}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const MinusIcon = () => (
  <Svg size={16}>
    <path d="M5 12h14" />
  </Svg>
)

export const FitIcon = () => (
  <Svg size={16}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
)

export const CloseIcon = () => (
  <Svg size={14}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const StepGlyph = () => (
  <svg className="glyph" viewBox="0 0 22 14" aria-hidden="true">
    <rect x="1" y="1" width="9" height="12" rx="2" fill="currentColor" />
    <rect x="12" y="3" width="4" height="3" rx="1" fill="currentColor" />
    <rect x="12" y="8" width="8" height="3" rx="1" fill="currentColor" />
  </svg>
)
