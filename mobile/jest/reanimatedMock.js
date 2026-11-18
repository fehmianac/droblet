// `react-native-reanimated` resolves here under Jest (package.json moduleNameMapper); the implementation is a
// separate file because expo-router's testing library re-mocks this module from `react-native-reanimated/mock`.
module.exports = require('./reanimatedMockImpl');
