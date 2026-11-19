import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { AnimatedSplash, SPLASH_TIMELINE } from '@/components/brand/AnimatedSplash';
import i18n from '@/i18n';

import { AiBackgroundAction, AiBusyButton, AiFailure, AiInlineStatus, AiProgressBar, AiProgressLines, AiSkeletonCards, AiTryOnStage } from './index';
import { revealTiming } from './motion';

function setReduceMotion(value: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(value);
}

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('revealTiming', () => {
  it('staggers elements and keeps every element on the same cycle length', () => {
    const base = { staggerMs: 300, cycleMs: 4800, enterMs: 1200, exitMs: 1200, exitAt: 1 };
    const first = revealTiming({ index: 0, ...base });
    const third = revealTiming({ index: 2, ...base });
    expect(first.delayMs).toBe(0);
    expect(third.delayMs).toBe(600);
    for (const t of [first, third]) expect(t.enterMs + t.holdMs + t.exitMs + t.restMs).toBe(4800);
  });

  it('stilist cards: hidden for the first 10 %, in by 30 %, shown until 85 %, out by the end of the 4.5 s loop', () => {
    const t = revealTiming({ index: 1, staggerMs: 500, cycleMs: 4500, leadMs: 450, enterMs: 900, exitMs: 675, exitAt: 1 });
    expect(t).toEqual({ delayMs: 500, leadMs: 450, enterMs: 900, holdMs: 2475, exitMs: 675, restMs: 0 });
  });

  it('never produces negative phases for a short cycle', () => {
    const t = revealTiming({ index: 1, staggerMs: 500, cycleMs: 1000, enterMs: 900, exitMs: 675, exitAt: 0.9 });
    expect(Math.min(t.delayMs, t.enterMs, t.holdMs, t.exitMs, t.restMs)).toBeGreaterThanOrEqual(0);
  });
});

describe('splash timeline', () => {
  it('ends exactly at 2.6 s', () => {
    const T = SPLASH_TIMELINE;
    const ends = [
      T.tile.delay + T.tile.duration,
      T.stroke.delay + T.stroke.duration,
      T.drop.delay + T.drop.duration,
      T.letters.delay + T.letters.stagger * 6 + T.letters.duration,
      T.settle.delay + T.settle.duration,
      T.rule.delay + T.rule.duration,
      T.tagline.delay + T.tagline.duration,
    ];
    expect(Math.max(...ends)).toBe(2600);
    expect(T.total).toBe(2600);
    // Logo B order: the square, then the "D", then the wordmark.
    expect(T.tile.delay).toBeLessThan(T.stroke.delay);
    expect(T.stroke.delay).toBeLessThan(T.letters.delay);
  });

  it('calls onDone after the last frame', async () => {
    jest.useFakeTimers();
    setReduceMotion(false);
    const onDone = jest.fn();
    await render(<AnimatedSplash onDone={onDone} />);
    expect(screen.getByTestId('animated-splash')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('with reduce-motion shows only the final frame, briefly', async () => {
    jest.useFakeTimers();
    setReduceMotion(true);
    const onDone = jest.fn();
    await render(<AnimatedSplash onDone={onDone} />);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('AI loading language', () => {
  it('rotates progress lines every 2 s and announces the current one', async () => {
    jest.useFakeTimers();
    setReduceMotion(false);
    await render(<AiProgressLines lines={['Parçalar hazırlanıyor…', 'Renkler eşleştiriliyor…']} />);
    expect(screen.getByText('Parçalar hazırlanıyor…')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Renkler eşleştiriliyor…')).toBeTruthy();
    expect(screen.getByLabelText('Renkler eşleştiriliyor…')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Parçalar hazırlanıyor…')).toBeTruthy();
  });

  it('keeps the first line with reduce-motion', async () => {
    jest.useFakeTimers();
    setReduceMotion(true);
    await render(<AiProgressLines lines={['Parçalar hazırlanıyor…', 'Renkler eşleştiriliyor…']} />);
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(screen.getByText('Parçalar hazırlanıyor…')).toBeTruthy();
  });

  it('failure says the credit was refunded and offers one retry action', async () => {
    const onRetry = jest.fn();
    await render(<AiFailure creditRefunded onRetry={onRetry} />);
    expect(screen.getByText('Şu an oluşturamadık. Kredin iade edildi.')).toBeTruthy();
    fireEvent.press(screen.getByText('Tekrar dene'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('failure without a reserved credit does not mention credits', async () => {
    await render(<AiFailure creditRefunded={false} onRetry={() => undefined} />);
    expect(screen.getByText('Şu an oluşturamadık.')).toBeTruthy();
  });

  it('offers "continue in the background"', async () => {
    const onPress = jest.fn();
    await render(<AiBackgroundAction onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('Arka planda devam et — bitince haber veririz'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the stage, skeleton cards and inline variants with their accessible status', async () => {
    setReduceMotion(false);
    await render(
      <>
        <AiTryOnStage className="h-[470px] w-full" />
        <AiSkeletonCards />
        <AiInlineStatus trailing="1 kredi" />
        <AiBusyButton />
        <AiProgressBar progress={0.5} accessibilityLabel="Foto 7" />
      </>,
    );
    expect(screen.getByText('SENİN ÜZERİNDE · HAZIRLANIYOR')).toBeTruthy();
    expect(screen.getByLabelText('Görsel hazırlanıyor, 1 kredi')).toBeTruthy();
    expect(screen.getByLabelText('Hazırlanıyor')).toBeTruthy();
    expect(screen.getByLabelText('Foto 7').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
  });

  it('a stopped stage is no longer busy and can hide its tag', async () => {
    setReduceMotion(false);
    await render(<AiTryOnStage className="h-[470px] w-full" active={false} tag={null} />);
    expect(screen.queryByText('SENİN ÜZERİNDE · HAZIRLANIYOR')).toBeNull();
  });
});
