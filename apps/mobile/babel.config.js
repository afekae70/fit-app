module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated 4 splits its worklet compiler into react-native-worklets, so THIS is the
      // plugin to list — not 'react-native-reanimated/plugin', which now only re-exports it.
      // It must stay last: it rewrites every function marked as a worklet, and any plugin
      // running after it would transform code the worklet compiler has already finished with.
      'react-native-worklets/plugin',
    ],
  };
};
