module.exports = function (api) {
  api.cache(true);
  return {
    // unstable_transformImportMeta is required for valtio (a dependency of
    // the Reown AppKit RN wallet stack) to work under Metro/Expo.
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
  };
};
