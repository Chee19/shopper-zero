// Demo presets for the landing form. The live target is chosen at T-60 (spec 05 §10.1) and written here.
export type DemoPreset = { label: string; url: string; note: string; demo: true };

export function demoPresets(wooDemoUrl: string | undefined): DemoPreset[] {
  return [
    { label: "Berlin Packaging", url: "https://www.berlinpackaging.com", note: "expected: DOM", demo: true },
    ...(wooDemoUrl ? [{ label: "ShoperZero Demo", url: wooDemoUrl, note: "expected: API", demo: true as const }] : []),
    { label: "Hester", url: "https://hester-demo.squarespace.com", note: "expected: API", demo: true },
  ];
}
