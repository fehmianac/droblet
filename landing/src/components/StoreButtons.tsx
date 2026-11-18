import type { Dictionary } from '@/lib/i18n';
import { appStoreUrl, playStoreUrl } from '@/lib/site';
import { Icon } from './Icons';

type Props = {
  labels: Dictionary['common'];
  /** The hero shows a download icon in each button; the closing section does not (canvas). */
  withIcon?: boolean;
  centered?: boolean;
  id?: string;
};

/**
 * Generic styled links to the stores — not the official badge artwork. A store whose URL is not
 * configured yet renders as a disabled "Yakında" pill instead of a link that goes nowhere.
 */
export function StoreButtons({ labels, withIcon = false, centered = false, id }: Props) {
  const stores = [
    { url: appStoreUrl, label: labels.appStore, soon: labels.appStoreSoon, style: 'btn' },
    { url: playStoreUrl, label: labels.googlePlay, soon: labels.googlePlaySoon, style: 'btn-secondary' },
  ];

  return (
    <div id={id} className={`flex flex-wrap gap-3 ${centered ? 'justify-center' : ''}`}>
      {stores.map((store) =>
        store.url ? (
          <a key={store.label} href={store.url} className={store.style} rel="noopener">
            {withIcon ? <Icon name="download" size={18} /> : null}
            {store.label}
          </a>
        ) : (
          <span key={store.label} className="btn-disabled">
            {store.soon}
          </span>
        ),
      )}
    </div>
  );
}
