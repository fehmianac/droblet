/**
 * The AI loading language (canvas v2 `AiYukleniyor*`): no spinners — shimmer, a traced figure,
 * assembling pieces, rotating progress sentences, staggered reveals and the breathing drop.
 * Every component has a static reduce-motion state. Failure: `AiFailure`; leaving: `AiBackgroundAction`.
 *
 * Typical compositions
 * - try-on wait (full screen): AiTryOnStage + AiProgressLines + AiBackgroundAction
 * - stylist wait: AiDropPulse + AiProgressLines + AiSkeletonCards + AiSkeletonRows
 * - image slot inside a card: AiShimmerImage (+ AiDropPulse / AiProgressLines size="compact")
 * - photo being recognised (12): AiScanLine over the photo + the status pill
 * - item tagging: AiShimmerImage + AiChipReveal · bulk rows: AiProgressBar · palette: AiSwatchReveal
 * - inline: AiInlineStatus, AiBusyButton
 */
export { AiShimmer, AiShimmerImage } from './AiShimmer';
export { AiScanLine } from './AiScanLine';
export { AiReveal, AiChipReveal, AiSwatchReveal, AI_NEUTRAL_TONES, toneColor, type RevealPreset } from './AiReveal';
export { AiSilhouetteTrace, AiAssemblingPieces, AiTryOnStage } from './AiStage';
export { AiProgressLines } from './AiProgressLines';
export { AiSkeletonCards, AiSkeletonRows } from './AiSkeletonCards';
export { AiDropPulse, AiInlineStatus, AiBusyButton, AiProgressBar } from './AiInline';
export { AiFailure, AiBackgroundAction } from './AiOutcome';
export { brandEasing, revealTiming } from './motion';
