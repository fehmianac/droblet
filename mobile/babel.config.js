module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // Jest runs the app code through the React Compiler as well (Metro enables it via `experiments.reactCompiler`),
    // so a value the compiler would memoize for good — e.g. a non-hook read of i18n in a component — fails in
    // the tests exactly as it does on the phone.
    overrides: process.env.NODE_ENV === 'test' ? [{ exclude: /node_modules/, plugins: ['babel-plugin-react-compiler'] }] : [],
  };
};
