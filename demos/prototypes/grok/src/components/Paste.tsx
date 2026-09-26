import { motion } from "framer-motion"
import { parseShopUrl } from "../model"
import { Favicon } from "./Favicon"

const pop = { type: "spring" as const, stiffness: 300, damping: 15, mass: 0.8 }

export function Paste({
  value,
  error,
  onChange,
  onStart,
}: {
  value: string
  error: string | null
  onChange: (value: string) => void
  onStart: () => void
}) {
  const preview = parseShopUrl(value)

  return (
    <section className="paste">
      <motion.div
        className="paste-copy"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26, mass: 0.8 }}
      >
        <p className="eyebrow">For shop owners</p>
        <h1>Can Grok buy from your shop?</h1>
        <p className="lede">
          Paste your link. Grok tries to shop the way an AI assistant does, then shows the
          sales that slip away, and the fix.
        </p>
      </motion.div>

      <form
        className="url-form"
        onSubmit={(event) => {
          event.preventDefault()
          onStart()
        }}
      >
        <label className="sr" htmlFor="shop-url">
          Your shop link
        </label>
        <div className="url-field">
          {preview ? <Favicon host={preview.host} /> : null}
          <input
            id="shop-url"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="yourshop.com"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <motion.button
            className="btn dark"
            type="submit"
            disabled={!value.trim()}
            whileHover={value.trim() ? { scale: 1.03 } : undefined}
            whileTap={value.trim() ? { scale: 0.98 } : undefined}
            transition={pop}
          >
            Let Grok try to buy
          </motion.button>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  )
}
