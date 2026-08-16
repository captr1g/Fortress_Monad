INSERT INTO market_registry (market_id, protocol, chain_id, name, reserve_address, market_key) VALUES
  ('aave-base-usdc', 'aave', 8453, 'USDC Supply/Borrow', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', NULL),
  ('aave-base-weth', 'aave', 8453, 'WETH Supply/Borrow', '0x4200000000000000000000000000000000000006', NULL),
  ('aave-base-cbeth', 'aave', 8453, 'cbETH Supply/Borrow', '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', NULL),
  ('morpho-base-weth-usdc-86', 'morpho', 8453, 'WETH/USDC 86% LLTV', NULL, '0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda'),
  ('morpho-base-cbbtc-usdc-86', 'morpho', 8453, 'cbBTC/USDC 86% LLTV', NULL, '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836'),
  ('morpho-base-usde-usdc-915', 'morpho', 8453, 'USDe/USDC 91.5% LLTV', NULL, '0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354')
ON CONFLICT (market_id) DO NOTHING;
