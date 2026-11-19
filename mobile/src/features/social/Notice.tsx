import { useCallback } from 'react';

import { toast } from '@/components/ui/toast';

/**
 * A short confirmation that goes away by itself ("Link kopyalandı", "Şikayetin alındı"). Now the one shared toast
 * of the app (canvas 13b); kept as a hook so the social screens keep their call sites.
 */
export function useNotice(): { show: (text: string, tone?: 'done' | 'problem') => void } {
  const show = useCallback((text: string, tone: 'done' | 'problem' = 'done') => {
    if (tone === 'problem') toast.error(text);
    else toast.success(text);
  }, []);
  return { show };
}
