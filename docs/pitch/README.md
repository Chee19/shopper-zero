# Shopper Zero pitch

Open [index.html](index.html) in a browser. The deck works offline and uses the project's existing logo and visual palette. Keep this folder in the repository so the logo's relative path resolves.

The presentation contains 10 main slides and two optional technical appendix slides. The speaker notes allocate about 2 minutes 35 seconds, including a 60-second demo, leaving a short buffer for a three-minute pitch. The main story explains the merchant and shopper experience in plain language. Technical terms appear alongside their purpose, and the appendix covers architecture and failure handling. Speaker notes include the talk track and repository sources.

## Presenting

- **Next / previous:** arrow keys, Page Down / Page Up, or the onscreen controls. Space also advances.
- **First / last:** Home / End.
- **Notes:** N or the Notes control. Escape closes the notes.
- **Fullscreen:** F or the Fullscreen control, where supported by the browser.
- **Direct slide link:** append `#7`, for example, to open the demo slide.
- **PDF:** use Print, choose Save as PDF, enable background graphics, and disable browser headers and footers. The stylesheet defines landscape 16:9 pages.

## Editing

Edit slide content and its adjacent speaker notes in `index.html`. Visual styling lives in `styles.css`; presentation controls live in `deck.js`. There are no external fonts, CDN scripts, or additional dependencies.

## Content basis

Branding follows the current [root README](../../README.md): **Shopper Zero**, with the tagline **Lighthouse for agentic checkout**. Product and demonstration content remains based on **origin/main at `b463fe8c5cf0567f4e9a413973d894b0f5f16097`**, fetched on 26 September 2026. No branch switch or merge was performed.

- [Product direction and current status](https://github.com/Chee19/shopper-zero/blob/b463fe8c5cf0567f4e9a413973d894b0f5f16097/README.md)
- [Binding decisions](https://github.com/Chee19/shopper-zero/blob/b463fe8c5cf0567f4e9a413973d894b0f5f16097/docs/specs/DECISIONS.md)
- [Lumière checkout demonstration](https://github.com/Chee19/shopper-zero/blob/b463fe8c5cf0567f4e9a413973d894b0f5f16097/docs/guides/checkout.md)
- [Team split](https://github.com/Chee19/shopper-zero/blob/b463fe8c5cf0567f4e9a413973d894b0f5f16097/docs/specs/TEAM-SPLIT.md)

Main documents a local before/after storefront and checkout demonstration using simulated payments. The complete live scanner, readiness score and reports remain in progress. The demonstration was not executed during deck creation; rehearse it on the current integrated branch before presenting slide 7 live. Update slide 8 when the implementation changes. The deployment was not evaluated.

The deck makes no claims of measured traction, universal store compatibility, guaranteed protocol discovery, live payments, or autonomous success from a human handoff. The pilot invitation is a proposed next step. The older 60-second readiness target and x402 plan are omitted because they do not describe the current demo.

The available presentation runtime did not include the PowerPoint authoring package, so the deliverable is an editable HTML presentation rather than a `.pptx` file.
