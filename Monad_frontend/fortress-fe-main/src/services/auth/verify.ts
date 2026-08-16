import { verifyMessage } from "viem";

export function buildAuthMessage(nonce: string, address: string): string {
  return `Sign in to Fortress\n\nNonce: ${nonce}\nAddress: ${address}`;
}

export async function recoverAndVerify(
  message: string,
  signature: `0x${string}`,
  expectedAddress: string
): Promise<boolean> {
  const valid = await verifyMessage({
    address: expectedAddress as `0x${string}`,
    message,
    signature,
  });
  return valid;
}
