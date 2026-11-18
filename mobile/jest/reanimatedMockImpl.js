/**
 * Hand-written Reanimated mock. The mock shipped with react-native-reanimated 4.7 imports the real
 * entry point, which throws under Jest (`setCSSEventHandler is not available in JSReanimated`), and
 * expo-router's testing library then silently replaces the module with `{}`.
 * Mapped in package.json (`moduleNameMapper`): `react-native-reanimated` → reanimatedMock.js → this file,
 * `react-native-reanimated/mock` → this file.
 *
 * Semantics: animations resolve instantly to their first target (`withSequence` → first step,
 * `withRepeat`/`withDelay` → the wrapped animation), so components render their "shown" state.
 */
const React = require('react');
const { FlatList, Image, ScrollView, Text, View } = require('react-native');

const ID = (value) => value;
const NOOP = () => {};

function makeShared(init) {
  const box = { value: init };
  box.get = () => box.value;
  box.set = (next) => {
    box.value = typeof next === 'function' ? next(box.value) : next;
  };
  box.addListener = NOOP;
  box.removeListener = NOOP;
  box.modify = NOOP;
  return box;
}

const timing = (toValue, _config, callback) => {
  if (typeof callback === 'function') callback(true);
  return toValue;
};

const easingFn = ID;
const Easing = {
  linear: easingFn,
  ease: easingFn,
  quad: easingFn,
  cubic: easingFn,
  sin: easingFn,
  circle: easingFn,
  exp: easingFn,
  bounce: easingFn,
  poly: () => easingFn,
  back: () => easingFn,
  elastic: () => easingFn,
  bezier: () => easingFn,
  bezierFn: () => easingFn,
  in: () => easingFn,
  out: () => easingFn,
  inOut: () => easingFn,
};

const Animated = {
  View,
  Text,
  Image,
  ScrollView,
  FlatList,
  createAnimatedComponent: ID,
  call: NOOP,
};

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  Easing,
  useSharedValue: (init) => React.useRef(makeShared(init)).current,
  makeMutable: makeShared,
  useDerivedValue: (fn) => makeShared(fn()),
  useAnimatedStyle: (fn) => fn(),
  useAnimatedProps: (fn) => fn(),
  useAnimatedRef: () => React.useRef(null),
  useAnimatedReaction: NOOP,
  useAnimatedScrollHandler: () => NOOP,
  useReducedMotion: () => false,
  useEvent: () => NOOP,
  useHandler: () => ({ context: {}, doDependenciesDiffer: false, useWeb: false }),
  withTiming: timing,
  withSpring: timing,
  withDecay: (_config, callback) => {
    if (typeof callback === 'function') callback(true);
    return 0;
  },
  withDelay: (_delay, animation) => animation,
  withRepeat: ID,
  withSequence: (...steps) => steps[0],
  withClamp: (_config, animation) => animation,
  cancelAnimation: NOOP,
  runOnJS: ID,
  runOnUI: ID,
  interpolate: (value, input, output) => {
    if (!Array.isArray(input) || !Array.isArray(output) || input.length < 2) return value;
    const t = (value - input[0]) / (input[input.length - 1] - input[0] || 1);
    return output[0] + (output[output.length - 1] - output[0]) * Math.max(0, Math.min(1, t));
  },
  interpolateColor: (_value, _input, output) => (Array.isArray(output) ? output[0] : undefined),
  Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
  ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
  measure: () => null,
  scrollTo: NOOP,
  setUpTests: NOOP,
  isSharedValue: (value) => Boolean(value) && typeof value === 'object' && 'value' in value && typeof value.set === 'function',
};
