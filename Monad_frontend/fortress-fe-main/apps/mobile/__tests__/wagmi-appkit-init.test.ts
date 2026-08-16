import { createAppKit } from "@reown/appkit-react-native";
import { WagmiAdapter } from "@reown/appkit-wagmi-react-native";
import { base } from "wagmi/chains";

// Regression guard: @reown/appkit-react-native and @reown/appkit-core-react-native
// each ship their own nested valtio copy. Two module instances means a proxy
// created by one package's valtio isn't recognized by the other's subscribe(),
// and createAppKit throws inside AppKit.watchBalance() ("Cannot read properties
// of undefined (reading '2')"). jest.config.js's moduleNameMapper (mirroring
// metro.config.js's resolver.extraNodeModules) forces a single instance — if
// either config drifts (e.g. a dependency bump moves the nested path), this
// test fails loudly instead of only crashing on-device.
test("createAppKit initializes without throwing (valtio single-instance check)", () => {
  const wagmiAdapter = new WagmiAdapter({
    projectId: "00000000000000000000000000000000",
    networks: [base],
  });

  expect(() =>
    createAppKit({
      projectId: "00000000000000000000000000000000",
      networks: [base],
      adapters: [wagmiAdapter],
      storage: {
        getKeys: async () => [],
        getEntries: async () => [],
        getItem: async () => undefined,
        setItem: async () => {},
        removeItem: async () => {},
      },
      metadata: {
        name: "Fortress",
        description: "Autonomous DeFi strategies",
        url: "https://app.fortress.exchange",
        icons: [],
      },
    }),
  ).not.toThrow();
});
