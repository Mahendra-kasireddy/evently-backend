/**
 * Evently's built-in setup data: the Home and Plan content, and the options
 * the planner and organizer registration offer (occasions, cities, categories,
 * business types…).
 *
 * The one copy of it. Used by
 *  - `npm run seed:config`, which inserts whatever a database is missing (and
 *    never overwrites what an admin has edited);
 *  - ContentService, which serves the content default when a database has no
 *    `site_content` document, so Home and Plan never break on an empty DB;
 *  - the admin "reset to default" for content.
 *
 * Admins edit the live copies in the console (App setup); these are only the
 * starting point.
 */

// ---- customer-home content (copy / CMS) ----
export const customerHomeContent = {
  nav: [
    { label: 'Home', to: '/home', active: true },
    { label: 'Plan event', to: '/plan' },
    { label: 'Discover', to: '/discover' },
    { label: 'My events', to: '/workspace' },
  ],
  hero: {
    greetingTemplate: 'Namaste, {name}',
    headingLead: 'What shall we ',
    headingAccent: 'celebrate',
    headingTail: ' next?',
    subtitle:
      'Tell us the occasion — verified organizers send tailored quotes within a day. You compare, you choose, they handle everything.',
    // The values under this label are the planner's starting selection - the
    // same for every account - so it must read as a prompt, not as a record of
    // what this customer has already told us. Their real event is shown from
    // their own plan/request/booking instead.
    draftLabel: 'PLAN YOUR EVENT · TAP TO CHOOSE',
    defaultDraft: { occasion: 'Wedding', when: '28 Dec', where: 'Hyderabad', guests: '300' },
    options: {
      occasion: [
        'Wedding',
        'Birthday',
        'Housewarming',
        'Naming ceremony',
        'Anniversary',
        'Corporate',
      ],
      when: ['28 Dec', '5 Jan', '14 Feb', '1 Mar', '20 Apr', '15 May'],
      where: ['Hyderabad', 'Bangalore', 'Chennai', 'Mumbai', 'Pune', 'Delhi'],
      guests: ['50', '100', '200', '300', '500', '800'],
    },
    trust: [
      { icon: 'zap', label: 'Quotes in under a day' },
      { icon: 'shield', label: 'Verified organizers only' },
      { icon: 'star', label: '4.8 average rating' },
    ],
  },
  planSection: {
    title: 'Plan any celebration',
    occasions: [
      { id: 'wedding', icon: 'heart', art: 'wedding', label: 'Wedding', cta: 'Start planning' },
      { id: 'birthday', icon: 'gift', art: 'birthday', label: 'Birthday', cta: 'Start planning' },
      {
        id: 'housewarming',
        icon: 'home',
        art: 'housewarming',
        label: 'Housewarming',
        cta: 'Start planning',
      },
      { id: 'naming', icon: 'sparkles', art: 'naming', label: 'Naming', cta: 'Start planning' },
      {
        id: 'anniversary',
        icon: 'star',
        art: 'anniversary',
        label: 'Anniversary',
        cta: 'Start planning',
      },
      {
        id: 'corporate',
        icon: 'briefcase',
        art: 'corporate',
        label: 'Corporate',
        cta: 'Start planning',
      },
    ],
  },
  howItWorks: {
    title: 'How Evently works',
    subtitle: 'Idea to celebration in four steps — you stay in control the whole way.',
    steps: [
      {
        num: '01',
        icon: 'edit',
        title: 'Tell us the occasion',
        description: 'Share your date, city, guests and budget in two minutes.',
      },
      {
        num: '02',
        icon: 'file',
        title: 'Get tailored quotes',
        description: 'Verified organizers reply with itemised quotes within a day.',
      },
      {
        num: '03',
        icon: 'chart',
        title: 'Compare side by side',
        description: 'Line-item breakdowns, ratings and anomaly alerts — no guesswork.',
      },
      {
        num: '04',
        icon: 'shield',
        title: 'Book with confidence',
        description: 'Pay a 30% advance; your organizer runs every vendor.',
      },
    ],
  },
  topOrganizers: { title: 'Top organizers near you', seeAllLabel: 'See all' },
  packages: {
    title: 'Curated packages by budget',
    subtitle: 'Pre-matched bundles to kick-start your planning — fully customisable.',
    buildLabel: 'Build your own',
  },
  tools: {
    title: 'Plan smarter with built-in tools',
    subtitle: 'Stay on budget and on schedule — free with every event you plan.',
    tools: [
      {
        id: 'budget',
        icon: 'wallet',
        title: 'Budget estimator',
        description: 'Instant city-based price ranges before you commit.',
      },
      {
        id: 'guests',
        icon: 'users',
        title: 'Guest list',
        description: 'Track invites, RSVPs and headcount in one place.',
      },
      {
        id: 'checklist',
        icon: 'list',
        title: 'Planning checklist',
        description: 'Auto-built timeline so nothing slips through.',
      },
      {
        id: 'reminders',
        icon: 'bell',
        title: 'Smart reminders',
        description: 'Nudges for payments, tastings and walkthroughs.',
      },
    ],
  },
};

// ---- Plan Event normalized config collections ----
// Occasions offered on the wizard's first step.
export const planOccasions = [
  { key: 'wedding', label: 'Wedding', art: 'wedding', order: 0, active: true },
  { key: 'birthday', label: 'Birthday', art: 'birthday', order: 1, active: true },
  { key: 'housewarming', label: 'Housewarming', art: 'housewarming', order: 2, active: true },
  { key: 'naming', label: 'Naming', art: 'naming', order: 3, active: true },
  { key: 'anniversary', label: 'Anniversary', art: 'anniversary', order: 4, active: true },
  { key: 'corporate', label: 'Corporate', art: 'corporate', order: 5, active: true },
];

// City options for the "event details" step.
export const planCities = [
  { name: 'Hyderabad', order: 0, active: true },
  { name: 'Bangalore', order: 1, active: true },
  { name: 'Chennai', order: 2, active: true },
  { name: 'Mumbai', order: 3, active: true },
  { name: 'Pune', order: 4, active: true },
  { name: 'Delhi', order: 5, active: true },
];

// Coarse guest-count buckets.
export const planGuestRanges = [
  { value: '50', order: 0, active: true },
  { value: '100', order: 1, active: true },
  { value: '200', order: 2, active: true },
  { value: '300', order: 3, active: true },
  { value: '500+', order: 4, active: true },
];

// Optional budget buckets (display strings). Configurable — tune without a deploy.
export const planBudgetRanges = [
  { value: 'Under ₹1L', order: 0, active: true },
  { value: '₹1L – 3L', order: 1, active: true },
  { value: '₹3L – 5L', order: 2, active: true },
  { value: '₹5L – 10L', order: 3, active: true },
  { value: '₹10L+', order: 4, active: true },
];

// Service categories the customer can request; `keywords` drive organizer matching.
export const planServiceCategories = [
  {
    key: 'food',
    title: 'Food / Catering',
    subtitle: 'Per-plate menu',
    icon: 'food',
    keywords: ['catering', 'food', 'full service'],
    order: 0,
    active: true,
  },
  {
    key: 'water',
    title: 'Drinking Water',
    subtitle: 'Branded bottles',
    icon: 'water',
    keywords: ['water', 'catering', 'full service'],
    order: 1,
    active: true,
  },
  {
    key: 'decoration',
    title: 'Decoration',
    subtitle: 'Theme & florals',
    icon: 'decor',
    keywords: ['decor', 'decoration', 'full service'],
    order: 2,
    active: true,
  },
  {
    key: 'photography',
    title: 'Photography & Video',
    subtitle: 'Photos, reels, album',
    icon: 'photo',
    keywords: ['photo', 'photography', 'full service'],
    order: 3,
    active: true,
  },
  {
    key: 'music',
    title: 'Music & Sound',
    subtitle: 'DJ / live band',
    icon: 'music',
    keywords: ['music', 'sound', 'dj', 'full service'],
    order: 4,
    active: true,
  },
  {
    key: 'priest',
    title: 'Priest / Pandit',
    subtitle: 'Rituals & muhurtham',
    icon: 'priest',
    keywords: ['priest', 'pandit', 'full service'],
    order: 5,
    active: true,
  },
  {
    key: 'mehendi',
    title: 'Mehendi Artist',
    subtitle: 'Bridal & guests',
    icon: 'mehendi',
    keywords: ['mehendi', 'full service'],
    order: 6,
    active: true,
  },
  {
    key: 'transport',
    title: 'Transportation',
    subtitle: 'Guest pickup',
    icon: 'transport',
    keywords: ['transport', 'travel', 'full service'],
    order: 7,
    active: true,
  },
];

// ---- customer-plan content (Plan Event wizard copy/config — CMS only) ----
export const customerPlanContent = {
  steps: [
    {
      id: 'details',
      label: 'Event details',
      heading: '',
      subtitle:
        'Share a few details and your ideas. Verified organizers send tailored quotes — no pricing needed now.',
    },
    {
      id: 'categories',
      label: 'Categories',
      heading: "What's on your checklist?",
      subtitle:
        'Choose the services you need. Organizers quote only for what you select — nothing extra.',
    },
    {
      id: 'organizers',
      label: 'Find organizers',
      heading: 'Find your perfect organizer',
      subtitle:
        'Verified, certified and rated by real families. Compare, request quotes, and book the one that fits.',
    },
    {
      id: 'review',
      label: 'Review',
      heading: 'Review & submit',
      subtitle:
        'Check everything looks right, then submit your plan and request a quote. You can go back and edit any step.',
    },
  ],
  subtitle:
    'Share a few details and your ideas. Verified organizers send tailored quotes — no pricing needed now.',
  trust: [
    { icon: 'zap', label: 'Quotes in a day' },
    { icon: 'shield', label: 'Verified organizers' },
    { icon: 'calendar', label: 'Free to plan' },
  ],
  whatNext: [
    { icon: 'file', title: 'Get tailored quotes', desc: 'Verified organizers reply within a day' },
    { icon: 'chart', title: 'Compare side by side', desc: 'Itemised, transparent breakdowns' },
    { icon: 'heart', title: 'Book & relax', desc: 'Your organizer runs every vendor' },
  ],
  ideas: {
    title: 'Your ideas & special requests',
    subtitle:
      'Surprises, inspirations, must-haves — in your own words. Your organizer plans around them, so nothing gets missed.',
    suggestions: [
      'Surprise entry',
      'Live food counters',
      'Drone photography',
      'Marigold & maroon theme',
      'Eco-friendly setup',
      'Kids play zone',
    ],
    placeholder:
      'e.g. Surprise drone petal-shower during the garland exchange, marigold theme, a live dosa counter for the cousins…',
  },
  budgetBanner:
    'Budget is optional. Share a rough range to help organizers tailor quotes, or skip it — you compare and pick what fits either way.',
  quoteNote: {
    title: 'Quotation by organizers',
    text: 'No budget needed now — price is finalized after organizers review your needs.',
  },
  continueLabel: 'Continue to categories',
  footnote: 'Verified organizers only. Comparing quotes is always free.',
  filters: {
    tiers: ['Bronze', 'Silver', 'Gold', 'Platinum'],
    ratings: ['4.0+', '4.5+', '4.8+'],
    categories: ['Catering', 'Decoration', 'Photography', 'Music & Sound'],
    sorts: ['Sort: Rating', 'Price', 'Most events', '4.5+ ★'],
  },
};

// ---- Organizer onboarding config collections (Step 1) ----
// Business/legal structure options.
export const businessTypes = [
  { key: 'individual', label: 'Individual / Freelancer', order: 0, active: true },
  { key: 'sole_proprietor', label: 'Sole Proprietorship', order: 1, active: true },
  { key: 'partnership', label: 'Partnership', order: 2, active: true },
  { key: 'llp', label: 'Limited Liability Partnership (LLP)', order: 3, active: true },
  { key: 'private_limited', label: 'Private Limited Company', order: 4, active: true },
  { key: 'agency', label: 'Agency', order: 5, active: true },
];

// Kind-of-organizer categories (distinct from customer service categories).
export const organizerCategories = [
  { key: 'wedding_planner', label: 'Wedding Planner', icon: 'heart', order: 0, active: true },
  { key: 'event_decorator', label: 'Event Decorator', icon: 'sparkles', order: 1, active: true },
  { key: 'caterer', label: 'Caterer', icon: 'utensils', order: 2, active: true },
  {
    key: 'photographer',
    label: 'Photographer / Videographer',
    icon: 'camera',
    order: 3,
    active: true,
  },
  {
    key: 'full_service',
    label: 'Full-Service Event Company',
    icon: 'briefcase',
    order: 4,
    active: true,
  },
  {
    key: 'birthday_planner',
    label: 'Birthday & Party Planner',
    icon: 'gift',
    order: 5,
    active: true,
  },
  { key: 'corporate_events', label: 'Corporate Events', icon: 'building', order: 6, active: true },
];

// ---- Organizer services config collections (Step 4) ----
export const experienceRanges = [
  { key: '0-1', label: 'Less than 1 year', order: 0, active: true },
  { key: '1-3', label: '1–3 years', order: 1, active: true },
  { key: '3-5', label: '3–5 years', order: 2, active: true },
  { key: '5-10', label: '5–10 years', order: 3, active: true },
  { key: '10+', label: '10+ years', order: 4, active: true },
];
export const teamSizes = [
  { key: 'solo', label: 'Just me', order: 0, active: true },
  { key: '2-5', label: '2–5 people', order: 1, active: true },
  { key: '6-10', label: '6–10 people', order: 2, active: true },
  { key: '11-25', label: '11–25 people', order: 3, active: true },
  { key: '25+', label: '25+ people', order: 4, active: true },
];
export const languages = [
  { key: 'english', label: 'English', order: 0, active: true },
  { key: 'hindi', label: 'Hindi', order: 1, active: true },
  { key: 'telugu', label: 'Telugu', order: 2, active: true },
  { key: 'tamil', label: 'Tamil', order: 3, active: true },
  { key: 'kannada', label: 'Kannada', order: 4, active: true },
  { key: 'marathi', label: 'Marathi', order: 5, active: true },
  { key: 'bengali', label: 'Bengali', order: 6, active: true },
];
export const travelOptions = [
  { key: 'no_travel', label: 'No travel', order: 0, active: true },
  { key: 'city_only', label: 'Within city', order: 1, active: true },
  { key: 'state_wide', label: 'Within state', order: 2, active: true },
  { key: 'pan_india', label: 'Anywhere in India', order: 3, active: true },
  { key: 'international', label: 'International', order: 4, active: true },
];
export const paymentMethods = [
  { key: 'cash', label: 'Cash', order: 0, active: true },
  { key: 'upi', label: 'UPI', order: 1, active: true },
  { key: 'bank_transfer', label: 'Bank transfer', order: 2, active: true },
  { key: 'card', label: 'Credit / Debit card', order: 3, active: true },
  { key: 'cheque', label: 'Cheque', order: 4, active: true },
];
export const workingDays = [
  { key: 'mon', label: 'Monday', order: 0, active: true },
  { key: 'tue', label: 'Tuesday', order: 1, active: true },
  { key: 'wed', label: 'Wednesday', order: 2, active: true },
  { key: 'thu', label: 'Thursday', order: 3, active: true },
  { key: 'fri', label: 'Friday', order: 4, active: true },
  { key: 'sat', label: 'Saturday', order: 5, active: true },
  { key: 'sun', label: 'Sunday', order: 6, active: true },
];
export const documentTypes = [
  { key: 'aadhaar', label: 'Aadhaar Card', order: 0, active: true },
  { key: 'passport', label: 'Passport', order: 1, active: true },
  { key: 'voter_id', label: 'Voter ID', order: 2, active: true },
  { key: 'driving_license', label: 'Driving License', order: 3, active: true },
];

/** The content documents an empty database falls back to, by key. */
export const CONTENT_DEFAULTS: Record<string, Record<string, unknown>> = {
  'customer-home': customerHomeContent,
  'customer-plan': customerPlanContent,
};
