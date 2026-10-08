/** The headers that a proxy or a tunnel adds. A request with one of them did not come directly. */
const PROXY_HEADERS = ["forwarded", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"];

function ipv4Parts(ip: string): number[] | null {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);

  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part < 256)
    ? parts
    : null;
}

/**
 * Tells if the address is on this machine, on a private network (RFC 1918), or on a Tailscale
 * network (100.64.0.0/10).
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4Parts(ip);

  if (v4) {
    const [a = 0, b = 0] = v4;

    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  const v6 = ip.toLowerCase();

  return v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/**
 * Tells if a request can connect without the pairing token. This is true for a request that comes
 * directly from a private address, such as a phone on the home network. A request through a
 * tunnel or a proxy must have the token, also when the tunnel runs on this machine.
 */
export function isTrustedRequest(ip: string | null, headers: Headers): boolean {
  if (ip === null || !isPrivateAddress(ip)) {
    return false;
  }

  return PROXY_HEADERS.every((name) => !headers.has(name));
}
