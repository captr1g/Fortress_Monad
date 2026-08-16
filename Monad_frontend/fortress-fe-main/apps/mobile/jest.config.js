module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@reown/.*|@walletconnect/.*|@wagmi/.*|wagmi|viem|valtio|@noble/.*|@scure/.*|abitype|ox))",
  ],
  // Mirrors metro.config.js's resolver.extraNodeModules fix: force every
  // "valtio" import onto one physical copy (see metro.config.js comment).
  moduleNameMapper: {
    "^valtio$": "<rootDir>/../../node_modules/@reown/appkit-react-native/node_modules/valtio",
    "^valtio/(.*)$": "<rootDir>/../../node_modules/@reown/appkit-react-native/node_modules/valtio/$1",
  },
};
