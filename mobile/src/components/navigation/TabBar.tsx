import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Compass, Shirt, Sparkles, Sun, User, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { sizes } from '@/theme/tokens';

type TabName = 'index' | 'wardrobe' | 'stylist' | 'discover' | 'profile';

const TABS: Record<TabName, { icon: LucideIcon; labelKey: `tabs.${'today' | 'wardrobe' | 'stylist' | 'discover' | 'profile'}` }> = {
  index: { icon: Sun, labelKey: 'tabs.today' },
  wardrobe: { icon: Shirt, labelKey: 'tabs.wardrobe' },
  stylist: { icon: Sparkles, labelKey: 'tabs.stylist' },
  discover: { icon: Compass, labelKey: 'tabs.discover' },
  profile: { icon: User, labelKey: 'tabs.profile' },
};

function isTab(name: string): name is TabName {
  return name in TABS;
}

/**
 * 5-tab bar: Bugün · Gardırop · Stilist (centre) · Keşfet · Profil.
 * 86 high including the bottom safe area; the Stilist button is a 56 circle raised 18 above the bar.
 * Only rendered for the five tab roots — detail/create/checkout routes live outside `(tabs)`.
 */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const height = Math.max(sizes.tabBar, 52 + insets.bottom);

  return (
    <View
      accessibilityRole="tabbar"
      className="flex-row border-t border-line bg-paper"
      style={{ height, paddingBottom: insets.bottom }}
    >
      {state.routes.map((route, index) => {
        if (!isTab(route.name)) return null;
        const tab = TABS[route.name];
        const focused = state.index === index;
        const label = t(tab.labelKey);
        const onPress = () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };

        if (route.name === 'stylist') {
          return (
            <View key={route.key} className="flex-1 items-center justify-end pb-1.5">
              <Pressable
                onPress={onPress}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: focused }}
                className="absolute h-tab-center w-tab-center items-center justify-center rounded-pill bg-ink active:opacity-85"
                style={{ top: -sizes.tabBarCenterRaise }}
              >
                <Icon icon={tab.icon} tone="paper" size={24} />
              </Pressable>
              <Text variant="tab" tone={focused ? 'ink' : 'muted'} numberOfLines={1} accessible={false}>
                {label}
              </Text>
            </View>
          );
        }

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            className="flex-1 items-center justify-center gap-1 pt-1"
          >
            <Icon icon={tab.icon} tone={focused ? 'ink' : 'muted'} />
            <Text variant="tab" tone={focused ? 'ink' : 'muted'} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
