import CheckoutDemo from "@/features/checkout/components/checkout-demo";
import { getMockService } from "@/features/checkout/runtime";
import type { ProductFixture } from "@/features/checkout/demo/fixtures";
export const dynamic = "force-dynamic";
export default async function DemoPage() {
  const enabled = process.env.SHOPPERZERO_MOCK_ENABLED === "1";
  let catalog: ProductFixture[] = [], catalogError: string | undefined;
  if (enabled) {
    try { catalog = await getMockService().catalog(); }
    catch { catalogError = "Lumière is unavailable. Start the store and reload this page."; }
  }
  return <CheckoutDemo enabled={enabled} catalog={catalog} catalogError={catalogError} />;
}
