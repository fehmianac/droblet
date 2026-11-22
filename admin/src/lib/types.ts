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
  | 'audit.view'
  | 'ai.manage'
  | 'ai.usage.view'
  | 'maintenance.manage';

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

/** Who a library piece / product is for (wire `segment`). Unisex shows to every user segment. */
export type CatalogSegment = 'women' | 'men' | 'unisex';
export const CATALOG_SEGMENTS: CatalogSegment[] = ['women', 'men', 'unisex'];

/** User / weekly edit segment that admins may author (teen stays closed). */
export type EditSegment = 'women' | 'men';
export const EDIT_SEGMENTS: EditSegment[] = ['women', 'men'];

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
  /** Older rows without a value are women. */
  segment: CatalogSegment;
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
  segment: EditSegment;
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

/** Akış F1 (wire names of the API's Occasion enum). The app's tabs: Ofis = office, Hafta sonu = weekend, Davet = dinner. */
export type Occasion = 'office' | 'dinner' | 'weekend' | 'wedding' | 'travel' | 'sport';
export const OCCASIONS: Occasion[] = ['office', 'weekend', 'dinner', 'wedding', 'travel', 'sport'];

export type FeedAuthorKind = 'edit' | 'stylist';
export const FEED_AUTHOR_KINDS: FeedAuthorKind[] = ['edit', 'stylist'];

export interface FeedAuthor {
  kind: FeedAuthorKind;
  name: Localized;
  handle: string | null;
  imageUrl: string | null;
}

export interface AdminFeedPost {
  id: string;
  /** null = every segment. */
  segment: EditSegment | null;
  author: FeedAuthor;
  occasion: Occasion;
  title: Localized;
  note: Localized | null;
  imageUrls: string[];
  productIds: string[];
  publishAt: string;
  sortOrder: number;
  published: boolean;
  retired: boolean;
  likeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminFeedStory {
  id: string;
  segment: EditSegment | null;
  author: { name: Localized; imageUrl: string | null };
  imageUrl: string;
  headline: Localized;
  productId: string | null;
  publishAt: string;
  expiresAt: string | null;
  sortOrder: number;
  published: boolean;
  retired: boolean;
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
  segment: CatalogSegment;
  /** True when no https image is stored (the app shows the garment placeholder). */
  needsImage: boolean;
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
  /** Teen mode (docs/api/teen.md §10). Optional: older API builds do not send it; `null` = age not given yet. */
  ageBand?: AgeBand | null;
}

export type AgeBand = 'adult' | 'teen';
export type TeenStatus = 'pendingParentalConsent' | 'active' | 'declined' | 'withdrawn';
export type TeenConsentEvent = 'requested' | 'resent' | 'approved' | 'declined' | 'withdrawn' | 'expired' | 'ended';

export interface TeenConsentHistoryEntry {
  at: string;
  event: TeenConsentEvent;
  textVersion: string | null;
  tryOnAllowed: boolean;
  /** SHA-256 of the IP, shortened to 12 hex characters (never the IP). */
  ipHash: string | null;
}

/** `GET v1/admin/user/{id}` → `teen` (null for adults). */
export interface AdminTeenStatus {
  status: TeenStatus;
  parentEmailMasked: string | null;
  requestSentAt: string | null;
  requestExpiresAt: string | null;
  approvedAt: string | null;
  parentAllowedTryOn: boolean;
  ownTryOnConsent: boolean;
  /** Date (yyyy-MM-dd) the account becomes adult. */
  adultFrom: string | null;
  photosPurgedAt: string | null;
  history: TeenConsentHistoryEntry[];
}

export interface AppUserDetail extends AppUserSummary {
  teen?: AdminTeenStatus | null;
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

export type ReportReason = 'spam' | 'inappropriate' | 'harassment' | 'impersonation' | 'minorSafety' | 'other';

/** Akış F2: a look a user shared to the home feed that was reported or taken off the feed automatically (`GET v1/admin/feed-user-post`). */
export interface FeedUserPost {
  id: string;
  ownerTenantId: string;
  ownerHandle: string | null;
  lookId: string;
  lookName: string | null;
  occasion: string | null;
  /** The cover the feed showed (short-lived presigned URL); null when the look has no ready cover. */
  imageUrl: string | null;
  sharedAt: string;
  /** `autoHidden` = off the feed after 3 distinct reporters, until restored or removed. */
  status: 'reported' | 'autoHidden';
  reporterCount: number;
  reasons: { reason: ReportReason; count: number }[];
  reports: { id: string; status: ReportStatus; reason: ReportReason; note: string | null; reporterTenantId: string | null; reporterHandle: string | null; createdAt: string }[];
  hiddenAt: string | null;
  restoredAt: string | null;
  likeCount: number;
  involvesTeen: boolean;
}

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
  /** `contentRemoved`: when the target was hidden from everyone but its owner. */
  contentRemovedAt: string | null;
  /** Set by `POST …/{id}/restore` (undo of `contentRemoved`). */
  contentRestoredAt: string | null;
  contentRestoredByUserId: string | null;
  /** Teen mode: the reporter or the target is a teen. The server lists `high` first on every page. */
  involvesTeen?: boolean;
  priority?: 'high' | 'normal';
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
  adminId: string | null;
  adminEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: string | null;
  after: string | null;
  ip: string | null;
}

// ── AI prompts and models (docs/api/admin.md §5b) ──────────────────────────────────────────────────────

export type AiPromptKind = 'instructions' | 'fragment' | 'request' | 'image' | 'schema';

export interface AiPromptFallback {
  at: string;
  fromVersion: number;
  toVersion: number;
  failures: number;
  reason: string;
  acknowledged: boolean;
}

export interface AiPromptSummary {
  key: string;
  feature: string;
  operation: string;
  kind: AiPromptKind;
  position: string;
  description: string;
  editable: boolean;
  publishedVersion: number;
  overridden: boolean;
  publishedBy: string | null;
  publishedAt: string | null;
  hasDraft: boolean;
  draftUpdatedBy: string | null;
  draftUpdatedAt: string | null;
  fallback: AiPromptFallback | null;
}

export interface AiPromptVariable {
  name: string;
  required: boolean;
  description: string;
  sample: string;
}

export interface AiPromptVersion {
  version: number;
  action: 'publish' | 'rollback' | 'auto_fallback';
  text: string | null;
  sourceVersion: number | null;
  author: string | null;
  at: string;
  note: string | null;
  live: boolean;
}

export interface AiPromptDetail {
  summary: AiPromptSummary;
  defaultText: string;
  publishedText: string | null;
  draftText: string | null;
  draftBaseVersion: number | null;
  variables: AiPromptVariable[];
  maxLength: number | null;
  defaultStaticPrefix: number;
  trialMode: 'chat' | 'preview' | 'none';
  imagesRequired: number;
  sampleInput: string | null;
  schema: string | null;
  warnings: string[];
  history: AiPromptVersion[];
}

export type AiTrialStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface AiTrial {
  id: string;
  type: 'prompt' | 'model' | 'models';
  status: AiTrialStatus;
  createdAt: string;
  finishedAt: string | null;
  key: string | null;
  model: string | null;
  effort: string | null;
  output: string | null;
  parsed: boolean | null;
  parseError: string | null;
  error: string | null;
  latencyMs: number | null;
  usedModel: string | null;
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  systemPrompt: string | null;
  userPrompt: string | null;
}

export interface AiTrialRequest {
  type: 'prompt' | 'model' | 'models';
  key?: string;
  text?: string;
  input?: string;
  imageUrls?: string[];
  model?: string;
  modelKind?: 'text' | 'image';
  effort?: string | null;
  serviceTier?: string | null;
}

export interface AiSettingField {
  key: string;
  type: 'int' | 'bool' | 'model' | 'choice' | 'operationList';
  min?: number | null;
  max?: number | null;
  value: number | boolean | string | null;
  options?: string[] | null;
  nullable?: boolean;
}

export interface AiModelSettings {
  settings: { group: string; parameters: string[]; fields: AiSettingField[] };
  availableModels: string[];
  modelsFetchedAt: string | null;
  reloadSeconds: number;
  limits: { group: string; parameters: string[]; fields: AiSettingField[] } | null;
  pricing: string | null;
}

// ── AI usage and cost (docs/api/admin.md §5c). Money is estimated micro-USD (1_000_000 = $1). ─────────────────

export type AiUsageOperation =
  | 'stylist_outfit'
  | 'stylist_week'
  | 'stylist_pack'
  | 'item_detection'
  | 'cleanup'
  | 'multi_item'
  | 'import_detect'
  | 'import_match'
  | 'import_cleanup'
  | 'palette'
  | 'photo_check'
  | 'tryon'
  | 'look_cover'
  | 'admin_trial'
  | 'other';

export type AiUsagePlan = 'free' | 'premium';

export interface AiUsageTotals {
  jobs: number;
  completed: number;
  failed: number;
  refunded: number;
  calls: number;
  callErrors: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  images: number;
  costMicroUsd: number;
}

export interface AiUsageOperationRow {
  operation: AiUsageOperation | string;
  jobs: number;
  failed: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  images: number;
  costMicroUsd: number;
}

export interface AiUsageModelRow {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  images: number;
  costMicroUsd: number;
}

export interface AiUsagePeriod {
  period: string;
  totals: AiUsageTotals;
  operations: AiUsageOperationRow[];
}

export interface AiUsageJob {
  id: string;
  kind: string;
  outcome: 'completed' | 'failed' | 'refunded' | 'running';
  failure: string | null;
  models: string[];
  durationMs: number | null;
  costMicroUsd: number | null;
  creditsCharged: number;
  creditsRefunded: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiUsageRates {
  usdTry: number;
  netMonthlyPlanTry: number;
  netYearlyPlanPerMonthTry: number;
}

export interface UserAiUsage {
  userId: string;
  tenantId: string;
  from: string;
  to: string;
  plan: AiUsagePlan;
  credits: { allowanceTotal: number; allowanceRemaining: number; packBalance: number };
  totals: AiUsageTotals;
  operations: AiUsageOperationRow[];
  models: AiUsageModelRow[];
  days: AiUsagePeriod[];
  months: AiUsagePeriod[];
  recentJobs: AiUsageJob[];
  rates: AiUsageRates;
}

export interface AiUsagePlanRow {
  plan: AiUsagePlan;
  activeUsers: number;
  totals: AiUsageTotals;
  costPerActiveUserMicroUsd: number;
  costPerActiveUserPer30DaysMicroUsd: number;
  shareOfMonthlyNet: number | null;
  shareOfYearlyNet: number | null;
}

export interface AiUsageTopUser {
  tenantId: string;
  userId: string | null;
  email: string | null;
  handle: string | null;
  plan: AiUsagePlan;
  costMicroUsd: number;
  calls: number;
  activeDays: number;
}

export interface AiUsageAnomaly {
  day: string;
  tenantId: string;
  userId: string | null;
  email: string | null;
  handle: string | null;
  plan: AiUsagePlan;
  costMicroUsd: number;
  medianMicroUsd: number | null;
  multiple: number | null;
  reasons: ('median' | 'absolute')[];
}

export interface AiUsageSummary {
  from: string;
  to: string;
  totals: AiUsageTotals;
  admin: AiUsageTotals;
  days: { day: string; costMicroUsd: number; calls: number; jobs: number; failed: number }[];
  operations: AiUsageOperationRow[];
  models: AiUsageModelRow[];
  plans: AiUsagePlanRow[];
  topUsers: AiUsageTopUser[];
  anomalies: AiUsageAnomaly[];
  rates: AiUsageRates;
  thresholds: { medianMultiplier: number; minHistoryDays: number; minDayUsd: number; absoluteDayUsd: number };
}

// ── Maintenance jobs (v1/admin/maintenance/*, maintenance.manage — super admin only) ──────────────────

export type MaintenanceRunStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
/** A run in one of these states blocks a new one (the server answers 409 maintenance_run_active). */
export const ACTIVE_MAINTENANCE_STATUSES: MaintenanceRunStatus[] = ['queued', 'running', 'cancelling'];
export type MaintenanceSkipReason = 'libraryOrCatalog' | 'originalOnly' | 'noImage' | 'notOwnCleaned' | 'cleanedMissing';
export type MaintenanceFailReason = 'copyFailed' | 'conflict' | 'error';

/** In a dry run `published` / `renditionsMade` mean "would publish" / "would make". */
export interface MaintenanceRun {
  id: string;
  kind: 'publishItemImages';
  dryRun: boolean;
  status: MaintenanceRunStatus;
  /** Tenants finished so far. */
  tenants: number;
  scanned: number;
  published: number;
  alreadyPublic: number;
  skipped: number;
  hidden: number;
  renditionsMade: number;
  failed: number;
  skipReasons: { reason: MaintenanceSkipReason; count: number }[];
  /** At most 100; `failed` is the full count. */
  failedItems: { tenantId: string; itemId: string; reason: MaintenanceFailReason }[];
  retryOf: string | null;
  onlyItemCount: number | null;
  startedBy: { id: string; email: string };
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
}
