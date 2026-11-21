import { useTranslation } from 'react-i18next';

import { useBodyProfile } from '@/api/profile';
import { useSession } from '@/auth/session';
import { useMyPhotos, useMyProfile } from '@/features/account/queries';
import { useConsents } from '@/features/consent/api';
import { useAiCredits } from '@/features/credits/useAiCredits';
import { bodyTypeForSegment } from '@/features/segment/catalog';
import { useSegment } from '@/features/segment/store';
import { teenGate, teenGateStop } from '@/features/teen/gate';
import { useTeenRules } from '@/features/teen/store';
import { useItems } from '@/features/wardrobe/queries';

import { computeRequirements, singleStepRequirements, type PhotoPath, type RequirementAction, type RequirementInput, type Requirements } from './logic';
import { requirementsFlow, useRequirementsFlow, type FlowRequest } from './store';

/** Everything the requirement rules read, from the queries the app already has (nothing new is fetched). */
export function useRequirementInput(): RequirementInput {
  const session = useSession();
  const consents = useConsents();
  const photos = useMyPhotos();
  const body = useBodyProfile();
  const credits = useAiCredits();
  const profile = useMyProfile();
  const items = useItems();
  const flow = useRequirementsFlow();
  const segment = useSegment();

  const bodyKnown = body.status === 'success';
  return {
    ageConfirmed: session.status === 'signedIn' ? (session.user.ageConfirmed ?? null) : null,
    validConsents: consents.data ? consents.data.consents.filter((c) => c.valid).map((c) => c.type) : null,
    hasBodyPhoto: photos.data ? photos.data.body.length > 0 : null,
    hasFacePhoto: photos.data ? photos.data.face !== null : null,
    // A body type of the other segment's set (after a segment change) counts as not chosen: asked once more.
    bodyType: bodyKnown ? bodyTypeForSegment(body.data?.bodyType ?? null, segment) : undefined,
    hasBodyProfile: bodyKnown ? body.data !== null : null,
    isMember: credits.remaining !== null ? credits.isMember : null,
    creditsRemaining: credits.remaining,
    cityId: profile.data ? (profile.data.cityId ?? null) : undefined,
    handle: profile.data ? profile.data.handle : undefined,
    itemCount: items.data ? items.data.length : null,
    cityDeclined: flow.cityDeclined,
    emailVerified: profile.data?.emailVerified,
  };
}

/**
 * What `action` still needs on this device right now (canvas 11). The photo path the user picked in this
 * session (or `path`) decides the try-on steps.
 *
 *   const req = useRequirements('tryOn');
 *   req.ready ? start() : open the flow
 */
export function useRequirements(action: RequirementAction, path?: PhotoPath | null, only?: FlowRequest['only']): Requirements {
  const input = useRequirementInput();
  const flow = useRequirementsFlow();
  if (only) return singleStepRequirements(only, input);
  return computeRequirements(action, input, path ?? flow.paths[action] ?? null);
}

/** "Boy fotoğrafın gerekiyor · 2 adım" (or "· 1 adım kaldı" once the user started and left the flow). */
export function useRequirementHint(req: Requirements): string | null {
  const { t } = useTranslation();
  const flow = useRequirementsFlow();
  if (req.ready || !req.hint) return null;
  const started = Boolean(flow.started[req.action]);
  const steps = t(started ? 'req.hint.left' : 'req.hint.steps', { count: req.count });
  return t('req.hint.format', { what: t(`req.hint.${req.hint}`), steps });
}

/**
 * A gated action: `run()` starts it at once when nothing is missing, otherwise opens the requirements sheet and
 * starts it after the last step. The hint and the count belong under / on the button.
 */
export function useGate(action: RequirementAction, onRun: () => void, options: { origin?: string | null } = {}) {
  const req = useRequirements(action);
  const hint = useRequirementHint(req);
  const teen = useTeenRules();
  const proceed = () => {
    if (req.ready) onRun();
    else requirementsFlow.open({ action, onResume: onRun, origin: options.origin ?? null });
  };
  return {
    req,
    hint,
    count: req.count,
    run: () => {
      // Canvas 18: a teen's locked or not-yet-explained action stops here first (the server enforces the same).
      if (teenGate.apply(teenGateStop(action, teen), proceed)) return;
      proceed();
    },
  };
}
