// ABI definitions for Monad Smart Contracts (ported from Monad_Contract/fortress/src)
// Used by EvmKernel, StrategyBuilder, and backend execution services.

// ── 1. FortVault (Core Router) ────────────────────────────────────────────────
export const fortVaultAbi = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "entries",
        type: "tuple[]",
        components: [
          { name: "protocolKey", type: "bytes32" },
          { name: "amount", type: "uint256" },
          { name: "minSharesOut", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "entries",
        type: "tuple[]",
        components: [
          { name: "protocolKey", type: "bytes32" },
          { name: "shares", type: "uint256" },
          { name: "minUsdcOut", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "rebalance",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "entries",
        type: "tuple[]",
        components: [
          { name: "fromProtocol", type: "bytes32" },
          { name: "toProtocol", type: "bytes32" },
          { name: "shares", type: "uint256" },
          { name: "minUsdcOut", type: "uint256" },
          { name: "minSharesOut", type: "uint256" },
          { name: "fromData", type: "bytes" },
          { name: "toData", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "depositFeeBps",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
] as const;

// ── 2. FortStrategyExecutor (Multi-Step Engine) ──────────────────────────────
export const strategyExecutorAbi = [
  {
    name: "executeStrategy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "inputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      {
        name: "steps",
        type: "tuple[]",
        components: [
          { name: "adapterId", type: "uint8" },
          { name: "action", type: "uint8" },
          { name: "tokenIn", type: "address" },
          { name: "bps", type: "uint16" },
          { name: "amountFixed", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
      { name: "sweepTokens", type: "address[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "adapters",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "adapterId", type: "uint8" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "MAX_STEPS",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

// ── 3. FortSwapRouter (Aggregator Swap + Split) ──────────────────────────────
export const fortSwapRouterAbi = [
  {
    name: "swapAndDeposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "inputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      { name: "minUsdcOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
      {
        name: "swapData",
        type: "tuple[]",
        components: [
          { name: "callTo", type: "address" },
          { name: "approveTo", type: "address" },
          { name: "sendingAssetId", type: "address" },
          { name: "receivingAssetId", type: "address" },
          { name: "fromAmount", type: "uint256" },
          { name: "callData", type: "bytes" },
          { name: "requiresDeposit", type: "bool" },
        ],
      },
      {
        name: "entries",
        type: "tuple[]",
        components: [
          { name: "protocolKey", type: "bytes32" },
          { name: "bps", type: "uint16" },
          { name: "minSharesOut", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

// ── 4. MorphoLeverageExecutor & MorphoExitExecutor ───────────────────────────
export const morphoLeverageExecutorAbi = [
  {
    name: "executeLeverage",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "initialCollateralAmount", type: "uint256" },
      { name: "borrowAmount", type: "uint256" },
      { name: "minCollateralFromSwap", type: "uint256" },
      { name: "swapTarget", type: "address" },
      { name: "swapCalldata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const morphoExitExecutorAbi = [
  {
    name: "executeExit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "repayAmount", type: "uint256" },
      { name: "withdrawCollateralAmount", type: "uint256" },
      { name: "minLoanFromSwap", type: "uint256" },
      { name: "swapTarget", type: "address" },
      { name: "swapCalldata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// ── 5. IShMonad (FastLane Liquid Staking on Monad) ────────────────────────────
export const shMonadAbi = [
  {
    name: "asset",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    name: "previewRedeem",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const;

// ── 6. CrossChainRouter ───────────────────────────────────────────────────────
export const crossChainRouterAbi = [
  {
    name: "depositCrossChain",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "usdcAmount", type: "uint256" },
      { name: "destChainId", type: "uint256" },
      { name: "destReceiver", type: "address" },
      { name: "lifiData", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "bytes32" }],
  },
  {
    name: "claimWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [],
  },
] as const;

// ── 7. Standard ERC-20 & ERC-4626 ─────────────────────────────────────────────
export const erc20Abi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const erc4626Abi = [
  {
    name: "previewDeposit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "previewRedeem",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "convertToShares",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
