import type { ClaimMethod } from "../lib/contracts";

export type ClaimView = {
  slug: string;
  domain: string;
  status: "pending" | "verified";
  token: string;
  method: ClaimMethod;
  verified_at: string | null;
  opted_out: boolean;
  instructions: {
    dns_txt: { host: string; alt_hosts: string[]; value: string };
    meta_tag: { url: string; html: string };
  };
};

export type CheckResult = { method: ClaimMethod; ok: boolean; observed: string[]; hint?: string };

export type ClaimAction = "start" | "rotate" | "verify" | "opt_out" | "opt_in";

export const TXT_PREFIX = "shoperzero-verify=";
export const META_NAME = "shoperzero-verify";

export function dnsHosts(host: string): string[] {
  const bare = host.startsWith("www.") ? host.slice(4) : null;
  return [`_shoperzero.${host}`, host, ...(bare ? [`_shoperzero.${bare}`, bare] : [])];
}

export function claimInstructions(host: string, token: string): ClaimView["instructions"] {
  const [first, ...alt] = dnsHosts(host);
  return {
    dns_txt: { host: first!, alt_hosts: alt, value: `${TXT_PREFIX}${token}` },
    meta_tag: { url: `https://${host}/`, html: `<meta name="${META_NAME}" content="${token}">` },
  };
}
