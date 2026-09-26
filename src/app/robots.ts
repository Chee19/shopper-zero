import type { MetadataRoute } from "next";

// Prerendered at build time: do not read request data here.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/v1/checkouts/", "/api/demo-wallet/", "/checkouts/"],
        other: { "Content-Signal": "search=yes, ai-input=yes, ai-train=no" },
      },
    ],
  };
}
