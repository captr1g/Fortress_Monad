/**
 * Analyze the failing deleverage calldata: is it well-formed hex, and does it
 * decode cleanly as MorphoExitExecutor.exitPosition? If yes, the "not enough input
 * to decode" RPC error is a transaction-submission problem, not a calldata problem.
 */
import { decodeFunctionData, isHex, size } from "viem";
import { morphoExitExecutorAbi } from "../src/chains/evm/config/base_abi.js";

const DATA =
  process.argv[2] ??
  "";

function main() {
  if (!DATA) {
    console.log("Pass the calldata hex as argv[2]");
    process.exit(0);
  }
  console.log("length (chars):", DATA.length);
  console.log("0x-prefixed    :", DATA.startsWith("0x"));
  const body = DATA.startsWith("0x") ? DATA.slice(2) : DATA;
  console.log("hex body length:", body.length, "| even?", body.length % 2 === 0);
  console.log("valid hex      :", isHex(DATA));
  try {
    console.log("byte size      :", size(DATA as `0x${string}`));
  } catch (e) {
    console.log("size err:", (e as Error).message);
  }
  try {
    const decoded = decodeFunctionData({ abi: morphoExitExecutorAbi, data: DATA as `0x${string}` });
    console.log("decoded fn     :", decoded.functionName);
    console.log(
      "args           :",
      JSON.stringify(decoded.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, 1200),
    );
  } catch (e) {
    console.log("DECODE FAILED  :", (e as Error).message);
  }
}
main();
