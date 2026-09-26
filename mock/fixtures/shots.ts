// Offline wireframe "screenshots" for the computer-use fixtures: data:image/svg+xml URIs, 1280×800, no image files.

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function mockShot(title: string, lines: string[], highlight?: string): string {
  const rows = lines
    .slice(0, 6)
    .map(
      (l, i) =>
        `<rect x="80" y="${250 + i * 70}" width="${520 - (i % 3) * 60}" height="34" rx="6" fill="#e4e2da"/>` +
        `<text x="96" y="${273 + i * 70}" font-size="20" fill="#55534c">${esc(l)}</text>`,
    )
    .join("");
  const hl = highlight
    ? `<rect x="720" y="420" width="420" height="96" rx="14" fill="#2f6bff" fill-opacity=".12" stroke="#2f6bff" stroke-width="4"/>` +
      `<text x="930" y="478" font-size="28" font-weight="600" fill="#2f6bff" text-anchor="middle">${esc(highlight)}</text>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800" font-family="Helvetica, Arial, sans-serif">` +
    `<rect width="1280" height="800" fill="#fbfaf6"/>` +
    `<rect width="1280" height="72" fill="#1c1c1a"/>` +
    `<text x="48" y="46" font-size="26" font-weight="700" fill="#f4f3ee">MERIDIAN</text>` +
    `<text x="900" y="45" font-size="20" fill="#c3c2b7">Shop   Men   Women   Cart (0)</text>` +
    `<text x="80" y="170" font-size="44" font-weight="700" fill="#0c0c0b">${esc(title)}</text>` +
    `<rect x="720" y="130" width="420" height="260" rx="16" fill="#e9e7df"/>` +
    rows +
    hl +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
