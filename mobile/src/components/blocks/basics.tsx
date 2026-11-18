import { Info, Search, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/theme/useThemeColors';

/** Small pill label: "Yakında", "Örnek", "1 fiyat düştü". `accent` = filled espresso. */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }) {
  return (
    <View className={`self-start rounded-pill px-2.5 py-1 ${tone === 'accent' ? 'bg-accent' : 'bg-sand'}`}>
      <Text variant="caption" tone={tone === 'accent' ? 'paper' : 'ink'} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * "SPONSORLU" — marks paid placements (creator strip, future sponsored edits and showcases, faz 3).
 * Sits on the image's top-left corner; announced to screen readers as "Sponsorlu içerik".
 */
export function SponsoredTag() {
  const { t } = useTranslation();
  return (
    <View
      className="self-start rounded-pill bg-paper/90 px-2.5 py-1"
      accessible
      accessibilityLabel={t('explore.sponsoredA11y')}
    >
      <Text variant="eyebrow" tone="ink">
        {t('explore.sponsored')}
      </Text>
    </View>
  );
}

/** Sand info box with an (i) icon — e.g. "Sepete eklemek satın alma yapmaz…". */
export function InfoNote({ children }: { children: string }) {
  return (
    <View className="flex-row gap-3 rounded-image-lg bg-sand p-3.5">
      <Icon icon={Info} size={18} />
      <Text variant="caption" className="flex-1">
        {children}
      </Text>
    </View>
  );
}

type SearchFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  /** Read by screen readers (the field has no visible label, as in the design). */
  label: string;
  placeholder: string;
  clearLabel: string;
};

/** Search input: paper field, leading magnifier, clear button when filled. */
export function SearchField({ value, onChangeText, label, placeholder, clearLabel }: SearchFieldProps) {
  const colors = useThemeColors();
  return (
    <View className="h-btn-primary flex-row items-center rounded-field border border-line bg-paper pl-4">
      <Icon icon={Search} size={18} tone="muted" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        maxFontSizeMultiplier={1.6}
        className="h-full flex-1 px-3 font-sans text-body text-ink"
      />
      {value !== '' ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          className="h-icon-btn w-icon-btn items-center justify-center"
        >
          <Icon icon={X} size={18} tone="muted" />
        </Pressable>
      ) : null}
    </View>
  );
}

type AvatarProps = {
  name: string;
  uri?: string | null;
  /** Diameter in points. */
  size?: number;
  /** Story ring: `new` = accent, `seen` = line. */
  ring?: 'new' | 'seen' | null;
};

/** Round avatar through `ImageSlot`; without a photo (or when it fails to load) the person's initials on sand. Decorative — the name is next to it. */
export function Avatar({ name, uri, size = 44, ring = null }: AvatarProps) {
  const inner = (
    <View style={{ width: size, height: size }}>
      <ImageSlot uri={uri} className="h-full w-full rounded-pill" placeholder={{ kind: 'avatar', name }} />
    </View>
  );
  if (!ring) return inner;
  return (
    <View className={`rounded-pill border-2 p-0.5 ${ring === 'new' ? 'border-accent' : 'border-line'}`} accessible={false}>
      {inner}
    </View>
  );
}

/** Paper card with the design's 20 radius and hairline border. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-card border border-line bg-paper ${className ?? ''}`}>{children}</View>;
}

type DangerButtonProps = { label: string; onPress: () => void; loading?: boolean; disabled?: boolean };

/** Destructive primary action (52 high, danger fill). Always labelled with text — colour never carries the meaning alone. */
export function DangerButton({ label, onPress, loading = false, disabled = false }: DangerButtonProps) {
  const colors = useThemeColors();
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      className={`h-btn-primary flex-row items-center justify-center rounded-pill bg-danger px-6 active:opacity-80 ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      {loading ? (
        <ActivityIndicator color={colors.paper} />
      ) : (
        <Text variant="button" tone="paper" numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
