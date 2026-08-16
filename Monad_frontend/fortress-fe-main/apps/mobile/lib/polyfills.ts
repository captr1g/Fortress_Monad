// Must be imported first, before any wagmi/viem/AppKit import anywhere in
// the app — react-native-compat patches globals (crypto, etc.) that those
// packages assume exist at module-load time.
import "@walletconnect/react-native-compat";
import "react-native-get-random-values";
