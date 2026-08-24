import { OrganizerTier } from './schemas/organizer-profile.schema';

export interface TierRequirements {
  events: number;
  avgRating: number;
  trainingStage: number;
  maxComplaints: number;
}

export interface TierConfigEntry {
  tier: OrganizerTier;
  commissionRate: number; // fraction, e.g. 0.12 = 12%
  /** Requirements to REACH this tier from the one below it. Silver has none — it's the floor. */
  requirements: TierRequirements | null;
  next: OrganizerTier | null;
}

/** Tier ladder + commission rates. A product/business decision, not derived data. */
export const TIER_CONFIG: Record<OrganizerTier, TierConfigEntry> = {
  [OrganizerTier.SILVER]: {
    tier: OrganizerTier.SILVER,
    commissionRate: 0.12,
    requirements: null,
    next: OrganizerTier.GOLD,
  },
  [OrganizerTier.GOLD]: {
    tier: OrganizerTier.GOLD,
    commissionRate: 0.08,
    requirements: { events: 10, avgRating: 4.0, trainingStage: 2, maxComplaints: 0 },
    next: OrganizerTier.PLATINUM,
  },
  [OrganizerTier.PLATINUM]: {
    tier: OrganizerTier.PLATINUM,
    commissionRate: 0.06,
    requirements: { events: 30, avgRating: 4.5, trainingStage: 3, maxComplaints: 0 },
    next: null,
  },
};

export const TIER_ORDER: OrganizerTier[] = [
  OrganizerTier.SILVER,
  OrganizerTier.GOLD,
  OrganizerTier.PLATINUM,
];

/** Highest tier whose requirements are all met by the given stats. */
export function computeEarnedTier(stats: {
  events: number;
  avgRating: number;
  trainingStage: number;
  complaints: number;
}): OrganizerTier {
  let earned: OrganizerTier = OrganizerTier.SILVER;
  for (const tier of TIER_ORDER) {
    const req = TIER_CONFIG[tier].requirements;
    if (!req) continue;
    const meets =
      stats.events >= req.events &&
      stats.avgRating >= req.avgRating &&
      stats.trainingStage >= req.trainingStage &&
      stats.complaints <= req.maxComplaints;
    if (meets) earned = tier;
  }
  return earned;
}
