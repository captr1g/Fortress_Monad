Deposit and earn yield:-
1) Deposit 1 USDC to Morpho = https://basescan.org/tx/0x957caaeda08b42de91ff33aa45c85512ba07dd15a728f447c09b44ea8840fac94
2) Deposit 1 USDC to Aave = https://basescan.org/tx/0xb899c58dc551cba6d3c0781f638f9a71f031504cd53e47c9a2d8463bc6bd6aea
3) Deposit 1 USDC to Fluid = https://basescan.org/tx/0xdcae66dc5dab33be1611e37dcfc91db643e7d67346b04a810b98079ebbd0a9e7
4) Deposit 1 USDC to Euler = https://basescan.org/tx/0x40772ce817b616d94039054cb6016e00bb36e3e06d5577fa1d68f910d28b0ab8
5) Deposit 1 USDC to Compound = https://basescan.org/tx/0x3a36e315e47dfb0c80ac6ab00820bac8e51a62ecd366dddb7224fdfc765eeef2
6) Lend 1 USDC to Morpho = https://basescan.org/tx/0xccc404229be2cead67e8fef0de40b8c6f4dc42bd79d00489250e4ba937468185
7) Deposit 1 USDC split 50% Morpho 50% Aave = https://basescan.org/tx/0x04a5af4ba49dbd44b235f6b3b6c5103e70c2aa452211e7b8d5859c83132d82ae
8) Deposit 1 USDC split 40% Aave 30% Fluid 30% Euler = https://basescan.org/tx/0xe074c282f2478c059e2ba4ac8b45b2de144d5022232d4a30f94b6795644d6460

Pendle fixed-yield vault (buy PT and hold):- = 
1) Deposit 1 USDC into Pendle fixed yield = https://basescan.org/tx/0x3767ebfbfb6a97be30e0364f1ff7b24d8239c74e3e1d427b67bf6a7ff6126640
2) Put 1 USDC into Pendle
3)Deposit 1 USDC split 50% Aave 50% Pendle // works
4)Deposit 1 USDC into Pendle 40acresUSDC // works 

Strategy — supply + borrow / loops (Morpho):-
1) Supply 1 USDC worth of cbETH as collateral to Morpho cbETH-USDC and borrow USDC at 50% LTV // works
2) I have 1 USDC on Base. Swap 100% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base. Borrow USDC at 30% LTV against cbETH. Swap 100% borrowed USDC to WETH, wrap WETH into cbETH, and supply 100% cbETH. // works
3) I have 1 USDC on Base. Swap 100% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base. Then repeat 2 times: borrow USDC at 35% LTV, swap borrowed USDC to WETH, wrap WETH into cbETH, and supply 100% cbETH. // works
4) I have 1 USDC on Base. Swap 100% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base. Borrow USDC at 30% LTV against cbETH. // works
5) Loop cbETH/USDC on Morpho at 60% LTV, 3 times, starting with 1 USDC // works

Leverage — one-signature flash-loan (exact multiplier):-
1) Open 2x leverage on cbETH with 1 USDC // works
2) Long cbETH 2x with 1 USDC // works and this says Open 2x leverage: supply ~2000000 loan-token of collateral, borrow 1000000 (target LTV 50%)
3) Open 2x leverage on wstETH with 1 USDC // works
4) Leverage 1 USDC into cbETH at 2x // works

Bridge (USDC → another chain):-
1) Withdraw all from Morpho = https://basescan.org/tx/0x9f27c12c31e13c20936ba9931878ae2742d751a9f064c32f6e196f99f4345773
2) Withdraw 1 USDC from Aave = https://basescan.org/tx/0x8becf41d5714e8a7820123fac25c96c3c13ecaefea43f3d19a02c50fc395fbe2
3) Withdraw 50% from Fluid = https://basescan.org/tx/0x218715e80a83fc8443fb3aa2de384d05a4729df8297be9107f3f30131bbcbb4a
4) withdraw all from Euler = https://basescan.org/tx/0x0dd8f08cef3e705d9d0fa200c68319c59b4cf08809f7e5f227d900ada8bd0012
5) Withdraw all from Compound = https://basescan.org/tx/0xfdef7da4efcedf829601ba7c7d3baeda838f2b2b57c4936e27c04ad08e1d6bd3
6) Withdraw all from morpho and aave = https://basescan.org/tx/0xdfb0f6f74c2556a69f0979da14246d8c6c04abeb3f0e0b16b87db23e9680a9c4
7) Withdraw all from Pendle // not working
8) Withdraw 50% from Pendle // not working

Rebalance:- 
Move all my Aave position to Morpho// works
Rebalance my Fluid position to Euler//works

Exit
