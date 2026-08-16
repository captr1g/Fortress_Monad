-- Monad migration: retire the Base (chain 8453) market registry.
--
-- 002_seed.sql and 003_staking.sql pre-seeded Base markets. On Monad the
-- poller would keep hitting a Base Aave pool address over a Monad RPC every
-- APY_POLL_INTERVAL_MS and logging failures forever. Those migrations are
-- left untouched (they may already be applied to a live database); this one
-- removes their rows going forward.
--
-- Deleting from market_registry, not market_rates, would orphan rate rows, so
-- the rates go first.
DELETE FROM market_rates
 WHERE market_id IN (SELECT market_id FROM market_registry WHERE chain_id = 8453);

DELETE FROM market_registry WHERE chain_id = 8453;

-- Monad seed. Only the Aave V3 Monad USDC reserve is pre-registered:
--
--  * The Morpho and staking rows are NOT recreated. ApyResolver.findOrRegister
--    inserts those on demand from a descriptor, and the only callers that
--    build such descriptors are the leverage/strategy paths — which stay
--    unregistered until the Monad executors are deployed. Seeding invented
--    market keys would put unverifiable rows in front of the poller.
--  * Neverland shares chain 143 with Aave V3 Monad, and AaveAdapter holds one
--    pool per chain id, so its rate comes from the per-protocol `aavePool`
--    in the chain config (see vault-apy.ts fetchAaveSupplyApy) instead.
--
-- USDC address verified live on Monad mainnet: symbol()="USDC", decimals()=6.
INSERT INTO market_registry (market_id, protocol, chain_id, name, reserve_address, market_key) VALUES
  ('aave-monad-usdc', 'aave', 143, 'USDC Supply/Borrow', '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', NULL),
  ('aave-monad-weth', 'aave', 143, 'WETH Supply/Borrow', '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242', NULL),
  ('aave-monad-wmon', 'aave', 143, 'WMON Supply/Borrow', '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', NULL)
ON CONFLICT (market_id) DO NOTHING;
