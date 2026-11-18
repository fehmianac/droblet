// Shapes of docs/api/admin.md and docs/api/store-social-settings.md §11. Enums are camelCase strings.

export type Localized = Record<string, string>;

export type Role = 'superAdmin' | 'contentEditor' | 'moderator';
export const ROLES: Role[] = ['superAdmin', 'contentEditor', 'moderator'];

export type Permission =
  | 'dashboard.view'
  | 'analytics.view'
  | 'catalog.manage'
  | 'content.manage'
  | 'image.upload'
  | 'users.read'
  | 'users.suspend'
  | 'users.delete'
  | 'users.grant'
  | 'moderation.manage'
  | 'settings.manage'
  | 'admins.manage'
  | 'audit.view';

export interface AdminMe {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permission[];
}

export interface AdminSession {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  admin: AdminMe;
}

export interface LoginChallenge {
  challengeId: string;
  expiresAt: string;
  codeLength: number;
}

export interface Paged<T> {
  items: T[];
  pageToken: string | null;
  count?: number;
}

export type AffiliateSource = 'network' | 'direct';
export type PriceBand = 'highStreet' | 'luxuryTouch';
export const PRICE_BANDS: PriceBand[] = ['highStreet', 'luxuryTouch'];
export const PRODUCT_CATEGORIES = [
  'tshirt', 'shirt', 'blouse', 'knitwear', 'sweatshirt', 'jacket', 'coat', 'trousers', 'jeans', 'skirt', 'shorts',
  'dress', 'shoes', 'bag', 'accessory', 'swimwear', 'skiwear', 'activewear',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const ITEM_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'bag', 'accessory', 'beachwear', 'skiwear'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
export const FABRICS = [
  'cotton', 'linen', 'wool', 'cashmere', 'silk', 'satin', 'chiffon', 'viscose', 'polyester', 'denim', 'leather', 'suede',
  'knit', 'velvet', 'tweed', 'nylon', 'fleece', 'down',
] as const;
export type CollectionKind = 'creator' | 'series';
export const COLLECTION_KINDS: CollectionKind[] = ['creator', 'series'];

export interface AdminBrand {
  id: string;
  name: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  source: AffiliateSource;
  network: string | null;
  checkoutUrl: string | null;
  clickIdParameter: string | null;
  commissionRateBps: number | null;
  retired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProduct {
  id: string;
  brandId: string;
  name: Localized;
  description: Localized | null;
  category: ProductCategory;
  colors: string[];
  sizes: string[];
  priceMinor: number;
  currency: string;
  previousPriceMinor: number | null;
  priceChangedAt: string | null;
  priceBand: PriceBand;
  images: string[];
  affiliateUrl: string | null;
  affiliateSource: AffiliateSource;
  retired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductWriteResult {
  product: AdminProduct;
  created: boolean;
  priceDropped: boolean;
  watchersFlagged: number;
}

export interface BulkRow {
  index: number;
  id: string;
  outcome: 'created' | 'updated' | 'invalid' | 'brand_not_found' | 'duplicate_id';
  errors?: Record<string, string[]>;
}

export interface BulkResult {
  created: number;
  updated: number;
  failed: number;
  rows: BulkRow[];
}

export interface EditVariant {
  priceBand: PriceBand;
  productIds: string[];
}

export interface EditLook {
  id: string | null;
  day: number;
  title: Localized;
  styleNote: Localized | null;
  imageUrl: string | null;
  variants: EditVariant[];
}

export interface AdminEdit {
  id: string;
  segment: 'women';
  weekStart: string;
  title: Localized;
  subtitle: Localized | null;
  coverImageUrl: string | null;
  looks: EditLook[];
  sponsorBrandId: string | null;
  sponsorName: Localized | null;
  published: boolean;
  retired: boolean;
  sponsored: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCollection {
  id: string;
  kind: CollectionKind;
  title: Localized;
  subtitle: Localized | null;
  imageUrl: string | null;
  sortOrder: number;
  sponsorName: Localized | null;
  retired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCollectionLook {
  id: string;
  collectionId: string;
  title: Localized;
  note: Localized | null;
  imageUrl: string | null;
  productIds: string[];
  sortOrder: number;
  retired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminLibraryItem {
  id: string;
  name: Localized;
  category: ItemCategory;
  colorIds: string[];
  fabric: string | null;
  seasons: Season[];
  imageUrl: string | null;
  sortOrder: number;
  retired: boolean;
  stored: boolean;
}

export interface UploadSlot {
  url: string;
  fields: Record<string, string>;
  key: string;
  publicUrl: string;
  expiresAt: string;
  maxBytes: number;
}

export interface Dashboard {
  users: { total: number; last7Days: number; suspended: number };
  catalog: { brands: number; products: number; activeProducts: number };
  content: { edits: number; publishedEdits: number; collections: number; libraryItems: number };
  moderation: { openReports: number };
}

export interface AppUserSummary {
  id: string;
  tenantId: string;
  email: string | null;
  displayName: string | null;
  handle: string | null;
  createdAt: string;
  suspended: boolean;
}

export interface AppUserDetail extends AppUserSummary {
  language: string;
  closetVisibility: string;
  providers: string[];
  suspendedAt: string | null;
  suspendReason: string | null;
  counts: { items: number; looks: number; trips: number; followers: number; following: number };
  entitlement: { tier: 'free' | 'premium'; source: string | null; expiresAt: string | null; testPremiumExpiresAt: string | null };
  credits: { allowanceTotal: number; allowanceRemaining: number; packBalance: number };
  itemRecognition: { used: number; limit: number; unlimited: boolean };
  devices: { deviceId: string; platform: string | null; updatedAt: string; pushEnabled: boolean }[];
}

export type ReportStatus = 'open' | 'resolved';
export type ReportResolution = 'dismissed' | 'contentRemoved' | 'userWarned' | 'userSuspended';

export interface ModerationReport {
  id: string;
  status: ReportStatus;
  reporterTenantId: string | null;
  reporterHandle: string | null;
  targetTenantId: string;
  targetHandle: string | null;
  targetKind: 'profile' | 'look' | 'item';
  targetId: string;
  reason: 'spam' | 'inappropriate' | 'harassment' | 'impersonation' | 'minorSafety' | 'other';
  note: string | null;
  createdAt: string;
  resolution: ReportResolution | null;
  resolutionNote: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
}

export interface RevenueBucket {
  key: string;
  conversions: number;
  gmvMinor: number;
  commissionMinor: number;
}

export interface RevenueDay {
  day: string;
  clicks: number;
  conversions: number;
  gmvMinor: number;
  commissionMinor: number;
}

export interface RevenueReport {
  from: string;
  to: string;
  currency: string;
  conversions: number;
  gmvMinor: number;
  commissionMinor: number;
  pending: number;
  approved: number;
  rejected: number;
  clicks?: number;
  byBrand: RevenueBucket[];
  byLook: RevenueBucket[];
  bySource: RevenueBucket[];
  byNetwork?: RevenueBucket[];
  byDay?: RevenueDay[];
}

export interface FunnelStep {
  name: string;
  events: number;
  actors: number;
  rateFromPrevious: number | null;
  rateFromFirst: number | null;
}

export interface FunnelReport {
  from: string;
  to: string;
  totalEvents: number;
  totalActors: number;
  steps: FunnelStep[];
}

export type SettingFieldType = 'int' | 'bool' | 'time' | 'weekdayTime' | 'timeZone';

export interface SettingField {
  key: string;
  type: SettingFieldType;
  min?: number | null;
  max?: number | null;
  value: number | boolean | string | null;
}

export interface SettingGroup {
  group: string;
  parameters: string[];
  fields: SettingField[];
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  passwordSet: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  adminId: string;
  adminEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: string | null;
  after: string | null;
  ip: string | null;
}
