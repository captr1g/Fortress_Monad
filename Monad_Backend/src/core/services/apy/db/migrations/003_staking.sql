ALTER TYPE protocol_type ADD VALUE IF NOT EXISTS 'staking';

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_registry_protocol_chain_key
  ON market_registry(protocol, chain_id, market_key)
  WHERE market_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_registry_protocol_chain_reserve
  ON market_registry(protocol, chain_id, reserve_address)
  WHERE reserve_address IS NOT NULL;

INSERT INTO market_registry (market_id, protocol, chain_id, name, reserve_address, market_key) VALUES
  ('staking-base-wsteth', 'staking', 8453, 'wstETH Staking', '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', NULL),
  ('staking-base-weeth', 'staking', 8453, 'weETH Staking', '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A', NULL),
  ('staking-base-cbeth', 'staking', 8453, 'cbETH Staking', '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', NULL)
ON CONFLICT (market_id) DO NOTHING;
