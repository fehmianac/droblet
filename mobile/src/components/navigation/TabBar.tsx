import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Compass, House, Sparkles, User, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { sizes } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

import { useTabBarHidden } from './tabBarVisibility';

export type TabName = 'index' | 'wardrobe' | 'stylist' | 'discover' | 'profile';

type LabelKey = `tabs.${'today' | 'wardrobe' | 'stylist' | 'discover' | 'profile'}`;

const ORDER: TabName[] = ['index', 'wardrobe', 'stylist', 'discover', 'profile'];

const TABS: Record<TabName, { icon: LucideIcon | 'hanger'; labelKey: LabelKey; href: '/' | '/wardrobe' | '/stylist' | '/discover' | '/profile' }> = {
  index: { icon: House, labelKey: 'tabs.today', href: '/' },
  wardrobe: { icon: 'hanger', labelKey: 'tabs.wardrobe', href: '/wardrobe' },
  stylist: { icon: Sparkles, labelKey: 'tabs.stylist', href: '/stylist' },
  discover: { icon: Compass, labelKey: 'tabs.discover', href: '/discover' },
  profile: { icon: User, labelKey: 'tabs.profile', href: '/profile' },
};

function isTab(name: string): name is TabName {
  return name in TABS;
}

/** The Gardırop glyph is the brand's hanger, drawn exactly as on the canvas tab bar (Lucide has no hanger). */
function HangerIcon({ color }: { color: string }) {
  return (
    <Svg width={sizes.icon} height={sizes.icon} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Path d="M10 6.5a2 2 0 1 1 2.6 1.9c-.4.2-.6.6-.6 1V10.5" stroke={color} strokeWidth={sizes.iconStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M12 10.5 3.4 17.4c-.6.5-.3 1.6.5 1.6h16.2c.8 0 1.1-1.1.5-1.6z"
        stroke={color}
        strokeWidth={sizes.iconStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

type BarProps = {
  /** The highlighted tab; `null` highlights none (the Stilist button carries its own selected state). */
  active: TabName | null;
  onPress: (tab: TabName) => void;
};

/**
 * The bar itself (canvas `.tabbar`): 86 high including the bottom safe area, paper, top hairline, content
 * starts 8 below the edge. Four 64-wide tabs (22 icon, 10.5 label; active = ink, semibold) around the
 * Stilist button — a 56 ink circle raised 18 above the bar with a soft shadow. The canvas draws NO text
 * under that button (`<a class="fab" aria-label="Stilist">` holds only the glyph); a label there would sit
 * under the raised circle and be half covered, so the name is carried by the accessibility label only.
 */
export function TabBarView({ active, onPress }: BarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const height = Math.max(sizes.tabBar, 56 + insets.bottom);

  return (
    <View testID="tab-bar" accessibilityRole="tablist" className="flex-row items-start justify-around border-t border-line bg-paper pt-2" style={{ height }}>
      {ORDER.map((name) => {
        const tab = TABS[name];
        const focused = active === name;
        const label = t(tab.labelKey);

        if (name === 'stylist') {
          return (
            <Pressable
              key={name}
              testID="tab.stylist"
              onPress={() => onPress(name)}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: focused }}
              hitSlop={4}
              className="h-tab-center w-tab-center items-center justify-center rounded-pill bg-ink shadow-lg active:opacity-85"
              style={{ marginTop: -sizes.tabBarCenterRaise }}
            >
              <Icon icon={Sparkles} tone="cream" size={24} />
            </Pressable>
          );
        }

        const tone = focused ? 'ink' : 'muted';
        return (
          <Pressable
            key={name}
            testID={`tab.${name === 'index' ? 'today' : name}`}
            onPress={() => onPress(name)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            hitSlop={{ top: 8, bottom: 8 }}
            className="w-16 items-center gap-[3px] pt-1"
          >
            {tab.icon === 'hanger' ? <HangerIcon color={colors[tone]} /> : <Icon icon={tab.icon} tone={tone} />}
            <Text variant={focused ? 'tabActive' : 'tab'} tone={tone} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tab bar of the five tab roots (rendered by the Tabs navigator). */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  // A tab root may own the bottom edge for a while (10 Gardırop multi-select: the selection bar replaces the menu).
  const hidden = useTabBarHidden();
  const current = state.routes[state.index]?.name;
  const active = current && isTab(current) ? current : null;
  if (hidden) return null;
  return (
    <TabBarView
      active={active}
      onPress={(name) => {
        const route = state.routes.find((r) => r.name === name);
        if (!route) return;
        const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (active !== name && !event.defaultPrevented) navigateToTab(route.key);
      }}
    />
  );
}

/**
 * The same bar on the list screens that live outside the tab navigator but keep the bottom menu on the
 * canvas: 07 Haftalık plan and 09 Takvim (Bugün), 21 Stil mağazası, 25 Arkadaş akışı and 27 Dolapları
 * keşfet (Keşfet), 24b İzleme listem (Profil). `owner` is the tab the list belongs to; it stays highlighted.
 * Detail, create and checkout screens never render this — they use `BottomActionBar`.
 */
export function ListTabBar({ owner }: { owner: Exclude<TabName, 'stylist'> }) {
  return (
    <TabBarView
      active={owner}
      onPress={(name) => {
        // Back to the tab navigator: drop the list from the stack, then show the chosen tab.
        router.dismissTo(TABS[name].href);
      }}
    />
  );
}
