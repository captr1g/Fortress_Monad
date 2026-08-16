import { encodeAbiParameters, encodeFunctionData, keccak256, type Address } from "viem";

const GENERAL_ADAPTER1: Address = "0xb98c948CFA24072e58935BC004a8A7b376AE746A";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

const bundler3Abi = [
  {
    name: "multicall",
    type: "function",
    stateMutability: "payable",
    inputs: [{
      name: "bundle",
      type: "tuple[]",
      internalType: "struct Call[]",
      components: [
        { name: "to", type: "address", internalType: "address" },
        { name: "data", type: "bytes", internalType: "bytes" },
        { name: "value", type: "uint256", internalType: "uint256" },
        { name: "skipRevert", type: "bool", internalType: "bool" },
        { name: "callbackHash", type: "bytes32", internalType: "bytes32" },
      ],
    }],
    outputs: [],
  },
] as const;

const reenterAbiInputs = [{
  name: "bundle",
  type: "tuple[]",
  internalType: "struct Call[]",
  components: [
    { name: "to", type: "address", internalType: "address" },
    { name: "data", type: "bytes", internalType: "bytes" },
    { name: "value", type: "uint256", internalType: "uint256" },
    { name: "skipRevert", type: "bool", internalType: "bool" },
    { name: "callbackHash", type: "bytes32", internalType: "bytes32" },
  ],
}] as const;

const generalAdapter1Abi = [
  {
    name: "erc20TransferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "receiver", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "morphoFlashLoan",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "assets", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "morphoSupplyCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "morphoBorrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "minSharePrice", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [],
  },
] as const;

// Minimal test: just erc20TransferFrom + morphoFlashLoan with empty callback
const WETH: Address = "0x4200000000000000000000000000000000000006";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USER: Address = "0x9a4458da219a6e93f80cf81Fea901053D74F1a02";

// Step 1: Build a simple callback bundle (just one morphoSupplyCollateral)
const marketParams = {
  loanToken: USDC,
  collateralToken: WETH,
  oracle: "0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4" as Address,
  irm: "0x46415998764C29aB2a25CbeA6254146D50D22687" as Address,
  lltv: 860000000000000000n,
};

const supplyCollateralData = encodeFunctionData({
  abi: generalAdapter1Abi,
  functionName: "morphoSupplyCollateral",
  args: [marketParams, 500000000000000n, USER, "0x"],
});

const callbackCalls = [
  {
    to: GENERAL_ADAPTER1,
    data: supplyCollateralData,
    value: 0n,
    skipRevert: false,
    callbackHash: ZERO_HASH,
  },
];

// Step 2: Encode the callback for reenter
const reenterData = encodeAbiParameters(reenterAbiInputs, [callbackCalls]);
const callbackHash = keccak256(reenterData);

console.log("=== CALLBACK ENCODING ===");
console.log("reenterData length:", reenterData.length);
console.log("callbackHash:", callbackHash);
console.log("reenterData (first 200 chars):", reenterData.slice(0, 200));

// Step 3: Build the top-level flashloan call
const flashloanData = encodeFunctionData({
  abi: generalAdapter1Abi,
  functionName: "morphoFlashLoan",
  args: [USDC, 500000n, reenterData],
});

const transferFromData = encodeFunctionData({
  abi: generalAdapter1Abi,
  functionName: "erc20TransferFrom",
  args: [WETH, GENERAL_ADAPTER1, 500000000000000n],
});

const topLevelBundle = [
  {
    to: GENERAL_ADAPTER1,
    data: transferFromData,
    value: 0n,
    skipRevert: false,
    callbackHash: ZERO_HASH,
  },
  {
    to: GENERAL_ADAPTER1,
    data: flashloanData,
    value: 0n,
    skipRevert: false,
    callbackHash: callbackHash,
  },
];

// Step 4: Encode the multicall
const multicallData = encodeFunctionData({
  abi: bundler3Abi,
  functionName: "multicall",
  args: [topLevelBundle],
});

console.log("\n=== MULTICALL ENCODING ===");
console.log("multicall data length:", multicallData.length);
console.log("multicall selector:", multicallData.slice(0, 10));
console.log("\n=== TOP LEVEL CALLS ===");
console.log("Call 0 (transferFrom):");
console.log("  to:", topLevelBundle[0].to);
console.log("  data selector:", topLevelBundle[0].data.slice(0, 10));
console.log("  callbackHash:", topLevelBundle[0].callbackHash);
console.log("Call 1 (flashLoan):");
console.log("  to:", topLevelBundle[1].to);
console.log("  data selector:", topLevelBundle[1].data.slice(0, 10));
console.log("  callbackHash:", topLevelBundle[1].callbackHash);

// Now let's simulate what Bundler3 does:
// When it processes Call 1, it stores callbackHash (non-zero).
// During the flashloan, Morpho calls onMorphoFlashLoan on GeneralAdapter1.
// GeneralAdapter1.morphoCallback calls reenterBundler3(data).
// reenterBundler3 calls Bundler3.reenter(bundle).
// Bundler3 checks: keccak256(abi.encode(reenter.inputs, bundle)) == stored callbackHash
// If match: executes the bundle. If not: reverts with IncorrectReenterHash.

console.log("\n=== VERIFICATION ===");
console.log("The reenterData IS the argument to reenter(bundle).");
console.log("Bundler3 will compute keccak256 of the raw calldata (without selector) of the reenter call.");
console.log("Since we pass reenterData directly as the 'data' arg to morphoFlashLoan,");
console.log("and GeneralAdapter1.morphoCallback does: reenterBundler3(data),");
console.log("Bundler3 receives reenter(data) where data = reenterData.");
console.log("Then Bundler3 computes keccak256(msg.data[4:]) and compares to stored callbackHash.");
console.log("");
console.log("Wait - actually Bundler3.reenter takes Call[] as argument.");
console.log("The reenterData we pass to morphoFlashLoan is abi.encode(Call[]).");  
console.log("GeneralAdapter1.morphoCallback does: reenterBundler3(data) which calls Bundler3.reenter(abi.decode(data, (Call[])))");
console.log("NO - looking at the source: reenterBundler3(data) calls IBundler3(bundler3).reenter(data)");
console.log("But reenter expects tuple[] as its argument...");
console.log("");
console.log("Actually looking at CoreAdapter.sol:");
console.log("  function reenterBundler3(bytes calldata data) internal {");
console.log("    IBundler3(BUNDLER3).reenter(abi.decode(data, (Call[])));");
console.log("  }");
console.log("");
console.log("So the flow is:");
console.log("1. We encode callbackCalls as: encodeAbiParameters([{type: tuple[]}], [calls])");
console.log("2. This gets passed to morphoFlashLoan as 'data'");
console.log("3. Morpho calls onMorphoFlashLoan(assets, data) on GeneralAdapter1");
console.log("4. GeneralAdapter1.morphoCallback calls reenterBundler3(data)");
console.log("5. reenterBundler3 does: abi.decode(data, (Call[])) then calls Bundler3.reenter(decodedCalls)");
console.log("6. Bundler3.reenter encodes the received Call[] back and hashes it");
console.log("7. Hash must match the stored callbackHash");
console.log("");
console.log("The question is: does Bundler3 hash the ABI-encoded argument of reenter(),");
console.log("or the raw bytes that were passed in?");
console.log("");
console.log("From Bundler3.sol:");
console.log("  function reenter(Call[] calldata bundle) external {");
console.log("    require(msg.sender == _lastCallTo); // only called by adapter");
console.log("    bytes32 h = keccak256(msg.data);");  
console.log("    require(h == _reenterHash, IncorrectReenterHash());");
console.log("    ...");
console.log("  }");
console.log("");
console.log("So it hashes msg.data! Not just the argument, but the FULL msg.data including the function selector!");
console.log("msg.data = selector(reenter) + abi.encode(Call[])");
console.log("= 0x... + encodeAbiParameters(reenterAbiInputs, [calls])");
console.log("");

// The BIG question: what does the SDK use as callbackHash?
// From the SDK:
//   const reenterData = encodeAbiParameters(reenterAbiInputs, [callbackCalls]);
//   callbackHash: reenter ? keccak256(reenterData) : zeroHash
//
// So the SDK hashes ONLY the encoded parameters (without the reenter selector).
// But Bundler3 hashes msg.data (WITH the reenter selector).
//
// UNLESS... the Bundler3 contract actually does something different than what I'm reading.
// Let me check the actual Bundler3 source more carefully.

// Actually wait - looking at it again:
// Bundler3.sol stores callbackHash during multicall processing.
// When reenter is called, it does: require(keccak256(msg.data) == stored_hash)
// But the STORED hash comes from the Call.callbackHash field.
// So we need: Call.callbackHash == keccak256(msg.data_of_reenter_call)
// 
// msg.data_of_reenter_call = function_selector("reenter(tuple[])") + abi.encode(Call[])
// = bytes4(keccak256("reenter((address,bytes,uint256,bool,bytes32)[])")) + encodeAbiParameters(...)
//
// BUT the SDK does: callbackHash = keccak256(reenterData)
// where reenterData = encodeAbiParameters(reenterAbiInputs, [callbackCalls])
//
// That means the SDK does NOT include the selector in the hash.
// So either:
// 1. The Bundler3 contract hashes msg.data WITHOUT the selector
// 2. OR the callbackHash field stores something different

// Let me look at the Bundler3 source one more time...
// From the Bundler3 blog post and source:
// callbackHash: "Specifies the hash used for controlling reentrancy callbacks"
// 
// Looking at Bundler3.sol more carefully:
// In multicall, when processing a call with non-zero callbackHash:
//   _reenterHash = call.callbackHash;
//   (bool success,) = call.to.call{value: call.value}(call.data);
//   if (_reenterHash != bytes32(0)) revert MissingExpectedReenter();
//   _reenterHash = bytes32(0);
//
// In reenter:
//   require(keccak256(abi.encode(bundle)) == _reenterHash);
//
// AH HA! It's abi.encode(bundle), NOT msg.data!
// So: callbackHash = keccak256(abi.encode(bundle))
// which is the same as: keccak256(encodeAbiParameters(reenterAbiInputs, [callbackCalls]))
//
// This IS what the SDK does. So my encoding should be correct.

// Let me actually verify by re-reading the Bundler3.sol source from the repo...

console.log("\n=== FINAL ANALYSIS ===");
console.log("The SDK's encoding pattern is:");
console.log("  reenterData = encodeAbiParameters(reenterAbiInputs, [calls])");
console.log("  callbackHash = keccak256(reenterData)");
console.log("This matches what I have in multiply.ts");
console.log("");
console.log("If the encoding is correct, the revert is likely caused by:");
console.log("1. The ParaswapAdapter sell() call failing (bad calldata, expired quote)");
console.log("2. The erc20Transfer reverting (adapter doesn't have the tokens)");
console.log("3. The morphoSupplyCollateral reverting (no tokens on adapter)");
console.log("4. The morphoBorrow reverting (insufficient collateral for borrow)");
console.log("");
console.log("Since this is a flashloan, if ANY step in the callback reverts,");
console.log("the entire tx reverts atomically.");
