// Draws each product as an inline SVG illustration so the store ships no photography.

const LABEL = '#fffaf0';
const INK = '#2b2418';

function label(x, y, w, h, name) {
  const words = name.split(' ');
  const line1 = words.slice(0, Math.ceil(words.length / 2)).join(' ');
  const line2 = words.slice(Math.ceil(words.length / 2)).join(' ');
  const cx = x + w / 2;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${LABEL}" opacity=".92"/>
    <text x="${cx}" y="${y + 13}" text-anchor="middle" font-family="Georgia, serif" font-size="7.5" letter-spacing="1.6" fill="${INK}">LUMIÈRE</text>
    <line x1="${cx - 10}" x2="${cx + 10}" y1="${y + 18}" y2="${y + 18}" stroke="${INK}" stroke-width=".5"/>
    <text x="${cx}" y="${y + 29}" text-anchor="middle" font-family="Georgia, serif" font-size="6.5" fill="${INK}">${line1}</text>
    <text x="${cx}" y="${y + 38}" text-anchor="middle" font-family="Georgia, serif" font-size="6.5" fill="${INK}">${line2}</text>`;
}

const SHAPES = {
  tube: ({ body, cap }, name) => `
    <path d="M62 44 H138 L128 176 H72 Z" fill="${body}"/>
    <path d="M62 44 H138 V52 H62 Z" fill="#000" opacity=".08"/>
    <rect x="80" y="176" width="40" height="30" rx="4" fill="${cap}"/>
    ${label(72, 86, 56, 46, name)}`,
  bottle: ({ body, cap }, name) => `
    <rect x="86" y="30" width="28" height="26" rx="4" fill="${cap}"/>
    <rect x="66" y="54" width="68" height="156" rx="16" fill="${body}"/>
    ${label(74, 104, 52, 46, name)}`,
  dropper: ({ body, cap }, name) => `
    <rect x="90" y="24" width="20" height="30" rx="9" fill="${cap}"/>
    <rect x="86" y="50" width="28" height="16" rx="3" fill="#2b2418"/>
    <rect x="70" y="66" width="60" height="140" rx="10" fill="${body}"/>
    <rect x="70" y="66" width="60" height="140" rx="10" fill="#fff" opacity=".12"/>
    ${label(76, 112, 48, 46, name)}`,
  spray: ({ body, cap }, name) => `
    <rect x="92" y="30" width="16" height="20" rx="3" fill="${cap}" stroke="#d8cfbd"/>
    <rect x="86" y="48" width="28" height="14" rx="3" fill="#d8cfbd"/>
    <rect x="70" y="60" width="60" height="148" rx="12" fill="${body}"/>
    ${label(76, 108, 48, 46, name)}`,
  jar: ({ body, cap }, name) => `
    <rect x="46" y="92" width="108" height="26" rx="6" fill="${cap}" stroke="#d8cfbd"/>
    <rect x="50" y="116" width="100" height="84" rx="14" fill="${body}"/>
    ${label(70, 132, 60, 46, name)}`,
  perfume: ({ body, cap }, name) => `
    <rect x="84" y="34" width="32" height="30" rx="4" fill="${cap}"/>
    <rect x="94" y="62" width="12" height="10" fill="#c9bfa8"/>
    <rect x="58" y="70" width="84" height="132" rx="8" fill="${body}" opacity=".85"/>
    <rect x="64" y="76" width="72" height="120" rx="6" fill="#fff" opacity=".14"/>
    ${label(72, 112, 56, 46, name)}`,
  box: ({ body, cap }, name) => `
    <rect x="40" y="84" width="120" height="116" rx="4" fill="${body}"/>
    <rect x="94" y="84" width="12" height="116" fill="${cap}"/>
    <rect x="40" y="128" width="120" height="12" fill="${cap}"/>
    <path d="M100 84 C84 60 64 70 78 84 Z M100 84 C116 60 136 70 122 84 Z" fill="${cap}"/>
    ${label(58, 146, 84, 44, name)}`,
};

export function productArt(p, { size = 240 } = {}) {
  const draw = SHAPES[p.art.shape] || SHAPES.bottle;
  return `<svg class="art" viewBox="0 0 200 240" width="${size * 200 / 240}" height="${size}" role="img" aria-label="${p.name}">
    <ellipse cx="100" cy="214" rx="64" ry="7" fill="#000" opacity=".07"/>
    ${draw(p.art, p.name)}
  </svg>`;
}
