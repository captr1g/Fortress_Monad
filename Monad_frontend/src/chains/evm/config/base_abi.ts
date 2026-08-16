// ABI of base contracts
// expand using {chain}_abi.ts

//deposit, withdraw, rebalance, swap-and-deposit
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

// FortVault fee read (used to compute fee-adjusted minSharesOut)
export const fortVaultFeeAbi = [
  {
    name: "depositFeeBps",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
] as const;

// FeeModule fee read — exposed by FortStrategyExecutor, MorphoLeverageExecutor,
// and CrossChainRouter. These skim `feeBps` from the INPUT before forwarding the
// net amount to the actual operation, so any pre-built calldata (LiFi routes,
// flash-swap amounts) must be sized off the net, not the gross, input.
export const feeModuleAbi = [
  {
    name: "feeBps",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
] as const;

//deposit-cross-chain, claim-withdraw, cancel-withdraw, get-deposit-request, get-withdraw-request
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
  {
    name: "cancelWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getDepositRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "destReceiver", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "destChainId", type: "uint256" },
          { name: "timestamp", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "getWithdrawRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "expectedAmount", type: "uint256" },
          { name: "actualAmount", type: "uint256" },
          { name: "minAcceptableAmount", type: "uint256" },
          { name: "sourceChainId", type: "uint256" },
          { name: "timestamp", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

// isAuthorized, setAuthorisation, position, market
export const morphoBlueAbi = [
  {
    name: "isAuthorized",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "authorized", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "setAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "authorized", type: "address" },
      { name: "newIsAuthorized", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "position",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "supplyShares", type: "uint256" },
      { name: "borrowShares", type: "uint128" },
      { name: "collateral", type: "uint128" },
    ],
  },
  {
    name: "market",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "totalSupplyAssets", type: "uint128" },
      { name: "totalSupplyShares", type: "uint128" },
      { name: "totalBorrowAssets", type: "uint128" },
      { name: "totalBorrowShares", type: "uint128" },
      { name: "lastUpdate", type: "uint128" },
      { name: "fee", type: "uint128" },
    ],
  },
] as const;

// Morpho Blue oracle: price of 1 collateral unit in loan-token units, scaled by 1e36.
export const morphoOracleAbi = [
  {
    name: "price",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// approve, allowance, balanceof
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

// ERC4626 onchain preview for slippage
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

// Compound V3 (Comet)
export const cometAbi = [
  {
    name: "allow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "manager", type: "address" },
      { name: "isAllowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "isAllowed",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "manager", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getUtilization",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getSupplyRate",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "utilization", type: "uint256" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

// FortStrategyExecutor ABI
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
] as const;

// Morpho Blue MarketParams ABI encoding
export const marketParamsAbiType = [
  {
    type: "tuple",
    components: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
  },
] as const;

// withdrawCollateral data: (MarketParams, uint256 withdrawAmount)
export const marketParamsWithAmountAbiType = [
  {
    type: "tuple",
    components: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
  },
  { type: "uint256" },
] as const;

// borrow data: (MarketParams, uint256 targetLtvWad, uint256 maxBorrow, uint256 minBorrow)
export const borrowDataAbiType = [
  {
    type: "tuple",
    components: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
  },
  { type: "uint256" }, // targetLtvWad
  { type: "uint256" }, // maxBorrow (ceiling)
  { type: "uint256" }, // minBorrow (dust floor)
] as const;

// Swap data ABI encoding: (address dex, address tokenOut, uint256 minAmountOut, bool useFullBalance, bytes swapCalldata)
export const swapDataAbiType = [
  { type: "address" },
  { type: "address" },
  { type: "uint256" },
  { type: "bool" },
  { type: "bytes" },
] as const;

// Pendle adapter data ABI encoding: (uint8 subAction, address tokenOut, uint256 minAmountOut, bool useFullBalance, bytes routerCalldata).
// Sub-action 0 = router relay (buy PT/YT/LP). Sub-action 1 = wrap LP (different encoding).
export const pendleDataAbiType = [
  { type: "uint8" },
  { type: "address" },
  { type: "uint256" },
  { type: "bool" },
  { type: "bytes" },
] as const;

// Pendle wrap LP data ABI encoding: (uint8 subAction=1, address wrapper, address wrappedToken).
export const pendleWrapDataAbiType = [
  { type: "uint8" },
  { type: "address" },
  { type: "address" },
] as const;

// MorphoExitExecutor ABI — exitPosition(ExitParams). ExitMode enum: 0=FULL_TO_LOAN, 1=FULL_TO_COLLATERAL, 2=DELEVERAGE
export const morphoExitExecutorAbi = [
  {
    name: "exitPosition",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          {
            name: "market",
            type: "tuple",
            components: [
              { name: "loanToken", type: "address" },
              { name: "collateralToken", type: "address" },
              { name: "oracle", type: "address" },
              { name: "irm", type: "address" },
              { name: "lltv", type: "uint256" },
            ],
          },
          { name: "mode", type: "uint8" },
          { name: "repayAssets", type: "uint256" },
          { name: "withdrawAssets", type: "uint256" },
          { name: "swapCollateralIn", type: "uint256" },
          { name: "minLoanOut", type: "uint256" },
          { name: "dex", type: "address" },
          { name: "swapCalldata", type: "bytes" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

// MorphoLeverageExecutor ABI  for Flash-loan entry that supplies (inputAssets + flashAssets) of collateral and borrows exactly flashAssets.
export const morphoLeverageExecutorAbi = [
  {
    name: "openLeverage",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          {
            name: "market",
            type: "tuple",
            components: [
              { name: "loanToken", type: "address" },
              { name: "collateralToken", type: "address" },
              { name: "oracle", type: "address" },
              { name: "irm", type: "address" },
              { name: "lltv", type: "uint256" },
            ],
          },
          { name: "inputAssets", type: "uint256" },
          { name: "flashAssets", type: "uint256" },
          { name: "minCollateralOut", type: "uint256" },
          { name: "dex", type: "address" },
          { name: "swapCalldata", type: "bytes" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

// Aave V3 Pool ABI for reserve data (liquidity rate, etc.)
export const aavePoolAbi = [
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "data",
        type: "tuple",
        components: [
          { name: "configuration", type: "uint256" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

// Set authorization ABI
export const setAuth = [
  {
    name: "setAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "authorized", type: "address" },
      { name: "newIsAuthorized", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export const DEPOSIT_DATA_ABI = [
  { type: "address" }, // market
  { type: "uint256" }, // minPtOut
  {
    type: "tuple", // guessPtOut (ApproxParams)
    components: [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
  },
  { type: "uint256" }, // deadline
] as const;
