const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo: Metro needs to see the workspace root (packages/core lives there)
// and resolve modules from both the app's and the root's node_modules.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// packages/core is consumed via its package.json "exports" map (subpaths
// like "./hooks/portfolio") — Metro must honor that map to resolve them.
config.resolver.unstable_enablePackageExports = true;

// @reown/appkit-react-native and @reown/appkit-core-react-native each ship
// their own nested "valtio" copy (npm doesn't dedupe them since they're
// siblings, not ancestor/descendant). Two separate module instances means
// a proxy object created by one package's valtio isn't recognized by the
// other's subscribe() — throws "Cannot read properties of undefined"
// inside AppKit.watchBalance(). Force everyone onto one physical copy.
//
// extraNodeModules is only a *fallback* used when normal resolution fails —
// since both nested copies genuinely exist, normal resolution finds them
// first and extraNodeModules is never consulted. resolveRequest intercepts
// every request unconditionally, so it's the one that actually works.
const CANONICAL_VALTIO = path.resolve(
  workspaceRoot,
  "node_modules/@reown/appkit-react-native/node_modules/valtio",
);
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "valtio" || moduleName.startsWith("valtio/")) {
    const rest = moduleName.slice("valtio".length);
    return context.resolveRequest(context, CANONICAL_VALTIO + rest, platform);
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
