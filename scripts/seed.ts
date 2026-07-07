/**
 * Idempotent seed script. Run with: npm run seed
 *
 * Populates the collections that back the customer home screen with the same
 * content that used to be hard-coded in the frontend. Re-running replaces the
 * seeded documents (matched by a stable natural key), so it's safe to repeat.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI is not set. Add it to .env first.');
  process.exit(1);
}

// ---- packages ----
const packages = [
  {
    badge: 'Budget pick',
    title: 'Birthday Bash',
    guests: '50–100 guests',
    budget: '₹40K – 80K',
    tags: ['Decor', 'Cake', 'Entertainment'],
    art: 'birthday',
    order: 0,
    active: true,
  },
  {
    badge: 'Most booked',
    title: 'Intimate Wedding',
    guests: '120–200 guests',
    budget: '₹2L – 3L',
    tags: ['Catering', 'Decor', 'Priest'],
    art: 'wedding',
    order: 1,
    active: true,
  },
  {
    badge: 'Premium',
    title: 'Grand Celebration',
    guests: '400+ guests',
    budget: '₹6L – 10L',
    tags: ['Full service', 'Photography', 'Music'],
    art: 'anniversary',
    order: 2,
    active: true,
  },
];

async function seedPackages() {
  const coll = mongoose.connection.collection('packages');
  for (const p of packages) {
    await coll.updateOne(
      { title: p.title }, // natural key
      { $set: { ...p, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  }
  const count = await coll.countDocuments();
  console.log(`✓ packages seeded (${packages.length} upserted, ${count} total)`);
}

// ---- organizers ----
const organizers = [
  {
    name: 'Sharma Events',
    initials: 'SE',
    avatarColor: '#7c5bd6',
    tier: 'Gold',
    rating: 4.8,
    reviews: 128,
    events: 214,
    tags: ['Catering', 'Decor', 'Photography'],
    location: 'Banjara Hills',
    estRange: '₹2.4L – 3.2L',
    rank: 30,
    active: true,
  },
  {
    name: 'Ravi Events',
    initials: 'RE',
    avatarColor: '#1a2e5a',
    tier: 'Silver',
    rating: 4.6,
    reviews: 82,
    events: 96,
    tags: ['Photography', 'Music'],
    location: 'Jubilee Hills',
    estRange: '₹1.8L – 2.6L',
    rank: 20,
    active: true,
  },
  {
    name: 'Telugu Vibes',
    initials: 'TV',
    avatarColor: '#1d9e75',
    tier: 'Platinum',
    rating: 4.9,
    reviews: 201,
    events: 340,
    tags: ['Full service', 'Decor'],
    location: 'Gachibowli',
    estRange: '₹2.8L – 4.1L',
    rank: 40,
    active: true,
  },
  {
    name: 'Mangala Celebrations',
    initials: 'MC',
    avatarColor: '#c2502a',
    tier: 'Gold',
    rating: 4.7,
    reviews: 154,
    events: 178,
    tags: ['Catering', 'Priest'],
    location: 'Kukatpally',
    estRange: '₹2.2L – 3.0L',
    rank: 25,
    active: true,
  },
];

async function seedOrganizers() {
  const coll = mongoose.connection.collection('organizer_profiles');
  for (const o of organizers) {
    await coll.updateOne(
      { name: o.name }, // natural key
      { $set: { ...o, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  }
  const count = await coll.countDocuments();
  console.log(`✓ organizers seeded (${organizers.length} upserted, ${count} total)`);
}

// ---- demo booking (per-user) ----
// Fills the demo user's name + city so the header renders like the design
// (avatar initials + location). Log in with SEED_DEMO_PHONE first.
async function seedDemoUser() {
  const phone = process.env.SEED_DEMO_PHONE;
  if (!phone) return;
  const users = mongoose.connection.collection('users');
  const user = await users.findOne({ phone });
  if (!user) {
    console.log(`• skipped demo user profile — no user with phone ${phone}. Log in once, then re-run.`);
    return;
  }
  await users.updateOne(
    { _id: user._id },
    { $set: { name: 'Priya Reddy', city: 'Hyderabad, Telangana', updatedAt: new Date() } },
  );
  console.log(`✓ demo user profile set (Priya Reddy · Hyderabad) for ${phone}`);
}

// Attaches one active booking to the user with phone SEED_DEMO_PHONE so the
// "BOOKED" home card is visible while testing. Log in with that number first.
async function seedDemoBooking() {
  const phone = process.env.SEED_DEMO_PHONE;
  if (!phone) {
    console.log('• skipped demo booking (set SEED_DEMO_PHONE to a logged-in number to enable)');
    return;
  }
  const users = mongoose.connection.collection('users');
  const user = await users.findOne({ phone });
  if (!user) {
    console.log(`• skipped demo booking — no user with phone ${phone}. Log in once, then re-run.`);
    return;
  }
  const bookings = mongoose.connection.collection('bookings');
  await bookings.updateOne(
    { customer: user._id, ref: 'EVT-2026-8841' },
    {
      $set: {
        customer: user._id,
        ref: 'EVT-2026-8841',
        title: 'Your Wedding · 28 Dec 2026',
        description:
          'Sharma Events is managing every vendor. Review the plan, approve your invitation, and track progress — all in one workspace.',
        eventDate: new Date('2026-12-28'),
        progress: 82,
        steps: [
          { label: 'Organizer booked', done: true },
          { label: 'Vendors locked', done: true },
          { label: 'Invitation', done: false },
          { label: 'Final walkthrough', done: false },
        ],
        status: 'active',
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  console.log(`✓ demo booking attached to ${phone}`);
}

// ---- customer-home content (copy / CMS) ----
const customerHomeContent = {
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
    draftLabel: 'YOUR EVENT SO FAR · TAP TO EDIT',
    defaultDraft: { occasion: 'Wedding', when: '28 Dec', where: 'Hyderabad', guests: '300' },
    options: {
      occasion: ['Wedding', 'Birthday', 'Housewarming', 'Naming ceremony', 'Anniversary', 'Corporate'],
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
    subtitle: 'Pick an occasion — get an instant estimate and matched organizers in seconds.',
    occasions: [
      { id: 'wedding', icon: 'heart', art: 'wedding', label: 'Wedding', cta: 'Start planning' },
      { id: 'birthday', icon: 'gift', art: 'birthday', label: 'Birthday', cta: 'Start planning' },
      { id: 'housewarming', icon: 'home', art: 'housewarming', label: 'Housewarming', cta: 'Start planning' },
      { id: 'naming', icon: 'sparkles', art: 'naming', label: 'Naming', cta: 'Start planning' },
      { id: 'anniversary', icon: 'star', art: 'anniversary', label: 'Anniversary', cta: 'Start planning' },
      { id: 'corporate', icon: 'briefcase', art: 'corporate', label: 'Corporate', cta: 'Start planning' },
    ],
  },
  howItWorks: {
    title: 'How Evently works',
    subtitle: 'Idea to celebration in four steps — you stay in control the whole way.',
    steps: [
      { num: '01', icon: 'edit', title: 'Tell us the occasion', description: 'Share your date, city, guests and budget in two minutes.' },
      { num: '02', icon: 'file', title: 'Get tailored quotes', description: 'Verified organizers reply with itemised quotes within a day.' },
      { num: '03', icon: 'chart', title: 'Compare side by side', description: 'Line-item breakdowns, ratings and anomaly alerts — no guesswork.' },
      { num: '04', icon: 'shield', title: 'Book with confidence', description: 'Pay a 30% advance; your organizer runs every vendor.' },
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
      { id: 'budget', icon: 'wallet', title: 'Budget estimator', description: 'Instant city-based price ranges before you commit.' },
      { id: 'guests', icon: 'users', title: 'Guest list', description: 'Track invites, RSVPs and headcount in one place.' },
      { id: 'checklist', icon: 'list', title: 'Planning checklist', description: 'Auto-built timeline so nothing slips through.' },
      { id: 'reminders', icon: 'bell', title: 'Smart reminders', description: 'Nudges for payments, tastings and walkthroughs.' },
    ],
  },
};

// ---- Plan Event normalized config collections ----
// Occasions offered on the wizard's first step.
const planOccasions = [
  { key: 'wedding', label: 'Wedding', art: 'wedding', order: 0, active: true },
  { key: 'birthday', label: 'Birthday', art: 'birthday', order: 1, active: true },
  { key: 'housewarming', label: 'Housewarming', art: 'housewarming', order: 2, active: true },
  { key: 'naming', label: 'Naming', art: 'naming', order: 3, active: true },
  { key: 'anniversary', label: 'Anniversary', art: 'anniversary', order: 4, active: true },
  { key: 'corporate', label: 'Corporate', art: 'corporate', order: 5, active: true },
];

// City options for the "event details" step.
const planCities = [
  { name: 'Hyderabad', order: 0, active: true },
  { name: 'Bangalore', order: 1, active: true },
  { name: 'Chennai', order: 2, active: true },
  { name: 'Mumbai', order: 3, active: true },
  { name: 'Pune', order: 4, active: true },
  { name: 'Delhi', order: 5, active: true },
];

// Coarse guest-count buckets.
const planGuestRanges = [
  { value: '50', order: 0, active: true },
  { value: '100', order: 1, active: true },
  { value: '200', order: 2, active: true },
  { value: '300', order: 3, active: true },
  { value: '500+', order: 4, active: true },
];

// Service categories the customer can request; `keywords` drive organizer matching.
const planServiceCategories = [
  { key: 'food', title: 'Food / Catering', subtitle: 'Per-plate menu', icon: 'food', keywords: ['catering', 'food', 'full service'], order: 0, active: true },
  { key: 'water', title: 'Drinking Water', subtitle: 'Branded bottles', icon: 'water', keywords: ['water', 'catering', 'full service'], order: 1, active: true },
  { key: 'decoration', title: 'Decoration', subtitle: 'Theme & florals', icon: 'decor', keywords: ['decor', 'decoration', 'full service'], order: 2, active: true },
  { key: 'photography', title: 'Photography & Video', subtitle: 'Photos, reels, album', icon: 'photo', keywords: ['photo', 'photography', 'full service'], order: 3, active: true },
  { key: 'music', title: 'Music & Sound', subtitle: 'DJ / live band', icon: 'music', keywords: ['music', 'sound', 'dj', 'full service'], order: 4, active: true },
  { key: 'priest', title: 'Priest / Pandit', subtitle: 'Rituals & muhurtham', icon: 'priest', keywords: ['priest', 'pandit', 'full service'], order: 5, active: true },
  { key: 'mehendi', title: 'Mehendi Artist', subtitle: 'Bridal & guests', icon: 'mehendi', keywords: ['mehendi', 'full service'], order: 6, active: true },
  { key: 'transport', title: 'Transportation', subtitle: 'Guest pickup', icon: 'transport', keywords: ['transport', 'travel', 'full service'], order: 7, active: true },
];

// ---- customer-plan content (Plan Event wizard copy/config — CMS only) ----
const customerPlanContent = {
  steps: [
    { id: 'details', label: 'Event details', heading: '', subtitle: 'Share a few details and your ideas. Verified organizers send tailored quotes — no pricing needed now.' },
    { id: 'categories', label: 'Categories', heading: "What's on your checklist?", subtitle: 'Choose the services you need. Organizers quote only for what you select — nothing extra.' },
    { id: 'organizers', label: 'Find organizers', heading: 'Find your perfect organizer', subtitle: 'Verified, certified and rated by real families. Compare, request quotes, and book the one that fits.' },
  ],
  subtitle: 'Share a few details and your ideas. Verified organizers send tailored quotes — no pricing needed now.',
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
    subtitle: 'Surprises, inspirations, must-haves — in your own words. Your organizer plans around them, so nothing gets missed.',
    suggestions: ['Surprise entry', 'Live food counters', 'Drone photography', 'Marigold & maroon theme', 'Eco-friendly setup', 'Kids play zone'],
    placeholder: 'e.g. Surprise drone petal-shower during the garland exchange, marigold theme, a live dosa counter for the cousins…',
  },
  budgetBanner: 'No need to set a budget. Organizers send tailored quotes after reviewing your event — you compare and pick what fits.',
  quoteNote: { title: 'Quotation by organizers', text: 'No budget needed now — price is finalized after organizers review your needs.' },
  continueLabel: 'Continue to categories',
  footnote: 'Verified organizers only. Comparing quotes is always free.',
  filters: {
    tiers: ['Bronze', 'Silver', 'Gold', 'Platinum'],
    ratings: ['4.0+', '4.5+', '4.8+'],
    categories: ['Catering', 'Decoration', 'Photography', 'Music & Sound'],
    sorts: ['Sort: Rating', 'Price', 'Most events', '4.5+ ★'],
  },
};

async function seedPlanConfig() {
  const sets: Array<{ collection: string; key: string; docs: Record<string, unknown>[] }> = [
    { collection: 'plan_occasions', key: 'key', docs: planOccasions },
    { collection: 'plan_cities', key: 'name', docs: planCities },
    { collection: 'plan_guest_ranges', key: 'value', docs: planGuestRanges },
    { collection: 'plan_service_categories', key: 'key', docs: planServiceCategories },
  ];
  for (const { collection, key, docs } of sets) {
    const coll = mongoose.connection.collection(collection);
    for (const doc of docs) {
      await coll.updateOne(
        { [key]: doc[key] }, // natural key
        { $set: { ...doc, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
    }
    console.log(`✓ ${collection} seeded (${docs.length})`);
  }
}

async function seedContent() {
  const coll = mongoose.connection.collection('site_content');
  await coll.updateOne(
    { key: 'customer-home' },
    {
      $set: { key: 'customer-home', data: customerHomeContent, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  await coll.updateOne(
    { key: 'customer-plan' },
    {
      $set: { key: 'customer-plan', data: customerPlanContent, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  console.log('✓ customer-home + customer-plan content seeded');
}

// ---- demo notifications (per-user) ----
async function seedDemoNotifications() {
  const phone = process.env.SEED_DEMO_PHONE;
  if (!phone) return; // silent — booking step already explains the flag
  const users = mongoose.connection.collection('users');
  const user = await users.findOne({ phone });
  if (!user) return;

  const notifications = mongoose.connection.collection('notifications');
  const demo = [
    {
      type: 'quote',
      title: 'New quote received',
      body: 'Sharma Events sent a quote for your Wedding.',
      link: '/quotes',
      read: false,
    },
    {
      type: 'booking',
      title: 'Vendors locked',
      body: 'All vendors for EVT-2026-8841 are confirmed.',
      link: '/workspace',
      read: false,
    },
    {
      type: 'system',
      title: 'Welcome to Evently',
      body: 'Tell us your occasion to get tailored quotes.',
      read: true,
    },
  ];
  for (const n of demo) {
    await notifications.updateOne(
      { user: user._id, title: n.title },
      {
        $set: { ...n, user: user._id, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }
  console.log(`✓ demo notifications attached to ${phone}`);
}

async function main() {
  await mongoose.connect(MONGO_URI as string);
  console.log('connected to MongoDB');
  await seedPackages();
  await seedOrganizers();
  await seedContent();
  await seedPlanConfig();
  await seedDemoUser();
  await seedDemoBooking();
  await seedDemoNotifications();
  await mongoose.disconnect();
  console.log('done.');
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
