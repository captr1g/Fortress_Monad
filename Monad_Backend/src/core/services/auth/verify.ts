// Wallet signature verification using viem's verifyMessage (EIP-191 personal_sign).

import { type Address, verifyMessage } from "viem";

const AUTH_MESSAGE_PREFIX = "Sign in to Fortress";

export function buildAuthMessage(nonce: string, address: string): string {
  return `${AUTH_MESSAGE_PREFIX}\n\nNonce: ${nonce}\nAddress: ${address.toLowerCase()}`;
}

export async function recoverAndVerify(
  message: string,
  signature: Address,
  expectedAddress: string,
): Promise<boolean> {
  try {
    return await verifyMessage({
      address: expectedAddress as Address,
      message,
      signature,
    });
  } catch {
    return false;
  }
}
