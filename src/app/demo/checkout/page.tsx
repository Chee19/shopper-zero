import CheckoutDemo from "./checkout-demo";
export const dynamic = "force-dynamic";
export default function DemoPage() {
  return <CheckoutDemo enabled={process.env.SHOPPERZERO_MOCK_ENABLED === "1"} />;
}
