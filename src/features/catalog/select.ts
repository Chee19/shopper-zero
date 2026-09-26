// src/lib/agent/select.ts  (WS3; pure): variant selection for get_product (spec 03 §4.3 steps 2–3).
import type { IndexedProduct } from "@/contracts";
import { variantMatches, type SelectedOption, type UcpMessage } from "@/features/catalog/formats/ucp";

export interface ProductSelection {
  selected: SelectedOption[] | undefined;
  variantIds: string[];
  messages: UcpMessage[];
}

/** Steps 2–3 of spec 03 §4.3: a variant ref selects that variant; `selected` narrows variants (case-insensitive). */
export function selectVariants(p: IndexedProduct, ref: string, selectedIn?: SelectedOption[]): ProductSelection {
  const messages: UcpMessage[] = [];
  const all = [...p.variants].sort((a, b) => a.position - b.position);
  let selected = selectedIn?.length ? selectedIn : undefined;
  const refVariant = all.find((v) => v.id === ref.toLowerCase()); // uuids resolve case-insensitively
  if (!selected && refVariant) {
    const pairs = Object.entries(refVariant.options).map(([name, label]) => ({ name, label }));
    if (pairs.length === 0) return { selected: undefined, variantIds: [refVariant.id], messages };
    selected = pairs;
  }
  if (!selected) return { selected: undefined, variantIds: all.map((v) => v.id), messages };
  const matching = all.filter((v) => variantMatches(v, selected));
  if (matching.length === 0) {
    messages.push({
      type: "warning",
      code: "no_matching_variant",
      content: `No variant matches ${selected.map((s) => `${s.name}: ${s.label}`).join(", ")}; showing all variants.`,
    });
    return { selected, variantIds: all.map((v) => v.id), messages };
  }
  return { selected, variantIds: matching.map((v) => v.id), messages };
}
