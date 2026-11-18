import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { isPaywallError } from '@/api/errors';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { ProductRow } from '@/components/ui/ProductRow';
import { Text } from '@/components/ui/Text';

import { useAnswerPurchasePrompt } from './mutations';
import { nextPurchasePrompt, shownPurchasePrompts } from './purchasePrompt';
import { usePurchasePrompts } from './queries';

/**
 * Flow 5.5 "Gardıroba ekleyelim mi?" — after a purchase on a brand site (conversion postback) the
 * server keeps a pending prompt. It is offered on the next app open (cold start or back to the
 * foreground), once per prompt per session: "Gardıroba ekle" lets the server add the pieces
 * (`PUT v1/tenant/purchase-prompt/{id} { accepted: true }`), "Hayır" dismisses it for good, "Sonra"
 * keeps it pending for the next session. 403 `premium_required` → paywall, the prompt stays pending.
 */
export function PurchasePromptHost() {
  const { t } = useTranslation();
  const prompts = usePurchasePrompts();
  const answer = useAnswerPurchasePrompt();
  // Re-render after a prompt is marked shown (the set itself is session state outside React).
  const [, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const prompt = nextPurchasePrompt(prompts.data, shownPurchasePrompts);

  const close = () => {
    if (prompt) shownPurchasePrompts.add(prompt.id);
    setFailed(false);
    setTick((n) => n + 1);
  };

  const respond = (accepted: boolean) => {
    if (!prompt) return;
    setFailed(false);
    answer.mutate(
      { id: prompt.id, accepted },
      {
        onSuccess: close,
        onError: (error) => {
          if (isPaywallError(error)) {
            close();
            router.push({ pathname: '/paywall', params: { from: 'purchase_prompt' } });
          } else {
            setFailed(true);
          }
        },
      },
    );
  };

  if (!prompt) return null;
  const count = prompt.products.length;
  return (
    <BottomSheet visible onClose={close}>
      <View className="gap-4" testID="purchase-prompt">
        <View className="gap-1.5">
          <Text variant="eyebrow">{t('purchasePrompt.eyebrow')}</Text>
          <Text variant="h2">{t('purchasePrompt.title')}</Text>
          <Text variant="body" tone="muted">
            {t('purchasePrompt.body', { brand: prompt.brandName, count })}
          </Text>
        </View>
        <View>
          {prompt.products.slice(0, 4).map((product) => (
            <ProductRow key={product.id} brand={product.brandName} name={product.name} price={product.price} imageUri={product.imageUrl} />
          ))}
          {count > 4 ? (
            <Text variant="caption" tone="muted">
              {t('purchasePrompt.more', { count: count - 4 })}
            </Text>
          ) : null}
        </View>
        {failed ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {t('purchasePrompt.failed')}
          </Text>
        ) : null}
        <View className="gap-2">
          <Button
            label={t('purchasePrompt.accept', { count })}
            onPress={() => respond(true)}
            loading={answer.isPending && answer.variables?.accepted === true}
            disabled={answer.isPending}
            testID="purchase-prompt-accept"
          />
          <Button
            variant="secondary"
            label={t('purchasePrompt.dismiss')}
            onPress={() => respond(false)}
            disabled={answer.isPending}
            testID="purchase-prompt-dismiss"
          />
          <Button variant="text" label={t('purchasePrompt.later')} onPress={close} disabled={answer.isPending} testID="purchase-prompt-later" />
        </View>
      </View>
    </BottomSheet>
  );
}
