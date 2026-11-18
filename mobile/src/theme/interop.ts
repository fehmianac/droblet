import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';

/** Lets third-party views take NativeWind `className` (React Native core views work out of the box). */
cssInterop(Image, { className: 'style' });
cssInterop(LinearGradient, { className: 'style' });
