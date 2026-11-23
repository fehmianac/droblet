import { EyeOff, Flag, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { FeedPost } from '@/api/contracts/feed';
import { REPORT_REASONS, type ReportReason } from '@/api/contracts/social';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { ReasonRow } from '@/features/social/ReportSheet';

import { useHideFeedPost, useReportFeedPost } from './mutations';

type Props = {
  /** The member's post whose "⋯" was tapped; null = closed. */
  post: FeedPost | null;
  onClose: () => void;
};

/**
 * "Gönderi seçenekleri" — the "⋯" of a member's look on Akış (canvas 06‴ Akış F2, decision 21): "Bunu gösterme"
 * (the post leaves this user's feed at once, no undo), "Şikâyet et" (the reasons of the existing report flow, canvas
 * 28; the report is private, the post is hidden on this device) and "Vazgeç". Editor posts have no such menu.
 */
export function PostMenuSheet({ post, onClose }: Props) {
  const { t } = useTranslation();
  const hide = useHideFeedPost();
  const report = useReportFeedPost();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason>('inappropriate');

  const close = () => {
    setReporting(false);
    setReason('inappropriate');
    onClose();
  };

  return (
    <BottomSheet visible={post !== null} onClose={close}>
      {post && !reporting ? (
        <View className="gap-1 pb-1" accessibilityLabel={t('homeFeed.postMenuA11y')} testID="feed.postMenu">
          <Text variant="caption" tone="muted" numberOfLines={1} className="pb-1 pt-1.5">
            {t('homeFeed.menu.subtitle', { author: post.author.name, title: post.title })}
          </Text>
          <Pressable
            onPress={() => {
              hide(post);
              close();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('homeFeed.menu.hide')}
            testID="feed.postMenu.hide"
            className="min-h-[52px] flex-row items-center gap-3 border-b border-line active:opacity-70"
          >
            <Icon icon={EyeOff} size={20} />
            <Text variant="body" className="text-[15px]">
              {t('homeFeed.menu.hide')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setReporting(true)}
            accessibilityRole="button"
            accessibilityLabel={t('homeFeed.menu.report')}
            testID="feed.postMenu.report"
            className="min-h-[52px] flex-row items-center gap-3 active:opacity-70"
          >
            <Icon icon={Flag} size={20} tone="danger" />
            <Text variant="body" tone="danger" className="text-[15px]">
              {t('homeFeed.menu.report')}
            </Text>
          </Pressable>
          <Button variant="secondary" label={t('homeFeed.menu.cancel')} onPress={close} className="mt-2" testID="feed.postMenu.cancel" />
        </View>
      ) : null}
      {post && reporting ? (
        <View className="gap-3 pb-3.5" accessibilityLabel={t('homeFeed.reportTitle')} testID="feed.report">
          <View className="flex-row items-center justify-between gap-3">
            <Text variant="h3" className="flex-1" accessibilityRole="header">
              {t('homeFeed.reportTitle')}
            </Text>
            <IconButton icon={X} variant="plain" onPress={close} accessibilityLabel={t('a11y.close')} className="-mr-2.5" />
          </View>
          <Text variant="caption" tone="muted">
            {t('report.body')}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('report.reasonLabel')}>
            {REPORT_REASONS.map((r, index) => (
              <ReasonRow key={r} label={t(`report.reason.${r}`)} selected={reason === r} last={index === REPORT_REASONS.length - 1} onPress={() => setReason(r)} />
            ))}
          </View>
          <Button
            label={t('report.submit')}
            testID="feed.report.submit"
            onPress={() => {
              report(post, reason);
              close();
            }}
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}
