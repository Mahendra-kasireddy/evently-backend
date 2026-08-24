/**
 * Evently Academy content. Static by nature (it's a curriculum, not user
 * data) — what's dynamic is each organizer's real progress against it,
 * tracked in AcademyProgress. There's no video hosting in this codebase, so
 * lessons are self-reported "mark complete" rather than a fake video player.
 */
export interface AcademyLesson {
  key: string;
  title: string;
  minutes: number;
}

export interface AcademyWorkshop {
  key: string;
  title: string;
  when: string;
}

export interface AcademyStage3Item {
  key: string;
  title: string;
}

export const STAGE1_LESSONS: AcademyLesson[] = [
  { key: 'app_walkthrough', title: 'App walkthrough', minutes: 6 },
  { key: 'profile_setup', title: 'Profile setup', minutes: 8 },
  { key: 'quote_builder', title: 'Quote builder', minutes: 12 },
  { key: 'payment_flow', title: 'Payment flow', minutes: 7 },
  { key: 'customer_comms', title: 'Customer comms', minutes: 9 },
];

export const STAGE2_WORKSHOPS: AcademyWorkshop[] = [
  { key: 'hyderabad_workshop', title: 'Hyderabad workshop', when: '28 Jun · 10 AM' },
  { key: 'live_zoom', title: 'Live Zoom session', when: '02 Jul · 6 PM' },
];

export const STAGE3_ITEMS: AcademyStage3Item[] = [
  { key: 'scaling_100', title: 'Scaling to 100+ events' },
  { key: 'pricing_psychology', title: 'Pricing psychology' },
  { key: 'subvendor_network', title: 'Building a sub-vendor network' },
];
