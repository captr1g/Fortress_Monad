
export type MorphoMarketItem = {
  loanAsset: { address: string };
  collateralAsset: { address: string };
  oracle: { address: string };
  irmAddress: string;
  lltv: string;
  state?: { supplyAssetsUsd?: number };
};
