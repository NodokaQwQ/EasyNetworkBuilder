// Match only sanitized backend categories; unknown errors retain their diagnostics.
export function virtualnetErrorKey(error: unknown): string | undefined {
  const text = String(error);
  if (text.includes("SSH host key mismatch")) return "virtualnet.errors.host_key";
  if (text.includes("SSH authentication failed")) return "virtualnet.errors.authentication";
  if (text.includes("SSH handshake timed out")) return "virtualnet.errors.timeout";
  if (text.includes("SSH endpoint unreachable")) return "virtualnet.errors.unreachable";
  if (text.includes("SSH handshake failed")) return "virtualnet.errors.handshake";
  if (text.includes("invalid SSH private key or passphrase")) return "virtualnet.errors.private_key";
  return undefined;
}
