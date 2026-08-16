export const fortVaultAbi = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      name: "entries",
      type: "tuple[]",
      components: [
        { name: "protocolKey", type: "bytes32" },
        { name: "amount", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
    }],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      name: "entries",
      type: "tuple[]",
      components: [
        { name: "protocolKey", type: "bytes32" },
        { name: "shares", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
    }],
    outputs: [],
  },
  {
    name: "rebalance",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      name: "entries",
      type: "tuple[]",
      components: [
        { name: "fromProtocol", type: "bytes32" },
        { name: "toProtocol", type: "bytes32" },
        { name: "shares", type: "uint256" },
        { name: "fromData", type: "bytes" },
        { name: "toData", type: "bytes" },
      ],
    }],
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
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export const crossChainRouterAbi = [
  {
    name: "depositCrossChain",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "usdcAmount", type: "uint256" },
      { name: "destChainId", type: "uint256" },
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
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "user", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "destChainId", type: "uint256" },
        { name: "timestamp", type: "uint64" },
        { name: "status", type: "uint8" },
      ],
    }],
  },
  {
    name: "getWithdrawRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "user", type: "address" },
        { name: "expectedAmount", type: "uint256" },
        { name: "actualAmount", type: "uint256" },
        { name: "sourceChainId", type: "uint256" },
        { name: "timestamp", type: "uint64" },
        { name: "status", type: "uint8" },
      ],
    }],
  },
] as const;

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
] as const;

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
