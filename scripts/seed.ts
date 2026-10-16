/**
 * DEMO seed — development only. Run with: npm run seed:demo -- --yes
 *
 * Adds SAMPLE packages and SAMPLE organizer profiles (fake businesses), and —
 * when SEED_DEMO_PHONE is set — a demo user profile, booking, notifications
 * and quotes. None of that belongs in a real database.
 *
 * The app's real setup data (options + Home/Plan content) comes from
 * `npm run seed:config`; this script also inserts it where missing, but never
 * overwrites a record that already exists.
 *
 * Refuses to run with NODE_ENV=production or a MONGO_URI that looks like
 * production, and without --yes.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  customerHomeContent,
  planOccasions,
  planCities,
  planGuestRanges,
  planBudgetRanges,
  planServiceCategories,
  customerPlanContent,
  businessTypes,
  organizerCategories,
  experienceRanges,
  teamSizes,
  languages,
  travelOptions,
  paymentMethods,
  workingDays,
  documentTypes,
} from '../src/modules/metadata/metadata.defaults';

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
// Enriched with the data the recommendation engine scores on: occasions,
// service areas, guest capacity, per-service pricing, responsiveness, venue.
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
    serviceAreas: ['Banjara Hills', 'Jubilee Hills', 'Gachibowli'],
    occasions: ['wedding', 'anniversary', 'naming'],
    capacityMin: 50,
    capacityMax: 600,
    basePrice: 40000,
    pricePerGuest: 350,
    categoryRates: [
      { key: 'food', price: 350, perGuest: true },
      { key: 'water', price: 15, perGuest: true },
      { key: 'decoration', price: 60000, perGuest: false },
      { key: 'photography', price: 45000, perGuest: false },
      { key: 'priest', price: 15000, perGuest: false },
    ],
    responseRate: 96,
    responseHours: 3,
    busyDates: [],
    indoor: true,
    outdoor: true,
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
    serviceAreas: ['Jubilee Hills', 'Madhapur', 'Kondapur'],
    occasions: ['birthday', 'corporate', 'housewarming'],
    capacityMin: 20,
    capacityMax: 300,
    basePrice: 25000,
    pricePerGuest: 300,
    categoryRates: [
      { key: 'food', price: 300, perGuest: true },
      { key: 'water', price: 14, perGuest: true },
      { key: 'photography', price: 35000, perGuest: false },
      { key: 'music', price: 40000, perGuest: false },
    ],
    responseRate: 88,
    responseHours: 6,
    busyDates: [],
    indoor: true,
    outdoor: false,
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
    tags: ['Full service', 'Decor', 'Catering', 'Photography', 'Music'],
    location: 'Gachibowli',
    serviceAreas: ['Gachibowli', 'Financial District', 'Kokapet', 'Banjara Hills'],
    occasions: ['wedding', 'birthday', 'corporate', 'anniversary', 'housewarming', 'naming'],
    capacityMin: 100,
    capacityMax: 1200,
    basePrice: 60000,
    pricePerGuest: 420,
    categoryRates: [
      { key: 'food', price: 420, perGuest: true },
      { key: 'water', price: 15, perGuest: true },
      { key: 'decoration', price: 80000, perGuest: false },
      { key: 'photography', price: 50000, perGuest: false },
      { key: 'music', price: 45000, perGuest: false },
      { key: 'priest', price: 18000, perGuest: false },
      { key: 'mehendi', price: 25000, perGuest: false },
      { key: 'transport', price: 35000, perGuest: false },
    ],
    responseRate: 99,
    responseHours: 2,
    busyDates: [],
    indoor: true,
    outdoor: true,
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
    serviceAreas: ['Kukatpally', 'Miyapur', 'KPHB'],
    occasions: ['wedding', 'naming', 'housewarming'],
    capacityMin: 50,
    capacityMax: 500,
    basePrice: 35000,
    pricePerGuest: 300,
    categoryRates: [
      { key: 'food', price: 300, perGuest: true },
      { key: 'water', price: 13, perGuest: true },
      { key: 'decoration', price: 50000, perGuest: false },
      { key: 'priest', price: 15000, perGuest: false },
    ],
    responseRate: 92,
    responseHours: 8,
    busyDates: [],
    indoor: true,
    outdoor: true,
    estRange: '₹2.2L – 3.0L',
    rank: 25,
    active: true,
  },
  {
    // Evently's own concierge — covers every service, occasion and area so the
    // recommendation list is never empty. Surfaced after real matches.
    name: 'Evently Concierge',
    initials: 'EV',
    avatarColor: '#e8633a',
    tier: 'Platinum',
    rating: 4.8,
    reviews: 500,
    events: 1000,
    tags: [
      'Full service',
      'Catering',
      'Decor',
      'Photography',
      'Music',
      'Priest',
      'Mehendi',
      'Transport',
    ],
    location: 'Hyderabad',
    serviceAreas: [
      'Hyderabad',
      'Banjara Hills',
      'Jubilee Hills',
      'Gachibowli',
      'Madhapur',
      'Kondapur',
      'Kukatpally',
      'Miyapur',
      'Secunderabad',
      'Financial District',
    ],
    occasions: ['wedding', 'birthday', 'housewarming', 'naming', 'anniversary', 'corporate'],
    capacityMin: 10,
    capacityMax: 5000,
    basePrice: 30000,
    pricePerGuest: 320,
    categoryRates: [
      { key: 'food', price: 320, perGuest: true },
      { key: 'water', price: 14, perGuest: true },
      { key: 'decoration', price: 55000, perGuest: false },
      { key: 'photography', price: 42000, perGuest: false },
      { key: 'music', price: 40000, perGuest: false },
      { key: 'priest', price: 15000, perGuest: false },
      { key: 'mehendi', price: 22000, perGuest: false },
      { key: 'transport', price: 30000, perGuest: false },
    ],
    responseRate: 100,
    responseHours: 1,
    busyDates: [],
    indoor: true,
    outdoor: true,
    concierge: true,
    estRange: '',
    rank: 0,
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
    console.log(
      `• skipped demo user profile — no user with phone ${phone}. Log in once, then re-run.`,
    );
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
        occasion: 'Wedding',
        location: 'Banjara Hills, Hyderabad',
        eventDate: new Date('2026-12-28'),
        amount: 284600,
        progress: 70,
        steps: [
          { label: 'Booking placed', done: true },
          { label: 'Organizer confirmed', done: true },
          { label: 'Event in progress', done: true },
          { label: 'Completed', done: false },
        ],
        timeline: [
          {
            status: 'pending',
            label: 'Booking placed — awaiting organizer confirmation',
            note: '',
            at: new Date('2026-06-01'),
          },
          {
            status: 'confirmed',
            label: 'Organizer confirmed your booking',
            note: '',
            at: new Date('2026-06-02'),
          },
          {
            status: 'in_progress',
            label: 'Your event is now in progress',
            note: '',
            at: new Date('2026-06-20'),
          },
        ],
        status: 'in_progress',
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  console.log(`✓ demo booking attached to ${phone}`);
}

async function seedPlanConfig() {
  const sets: Array<{ collection: string; key: string; docs: Record<string, unknown>[] }> = [
    { collection: 'plan_occasions', key: 'key', docs: planOccasions },
    { collection: 'plan_cities', key: 'name', docs: planCities },
    { collection: 'plan_guest_ranges', key: 'value', docs: planGuestRanges },
    { collection: 'plan_budget_ranges', key: 'value', docs: planBudgetRanges },
    { collection: 'plan_service_categories', key: 'key', docs: planServiceCategories },
  ];
  for (const { collection, key, docs } of sets) {
    const coll = mongoose.connection.collection(collection);
    for (const doc of docs) {
      await coll.updateOne(
        { [key]: doc[key] }, // natural key
        { $setOnInsert: { ...doc, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true },
      );
    }
    console.log(`✓ ${collection} seeded (${docs.length})`);
  }
}

async function seedOrganizerConfig() {
  const sets: Array<{ collection: string; key: string; docs: Record<string, unknown>[] }> = [
    { collection: 'business_types', key: 'key', docs: businessTypes },
    { collection: 'organizer_categories', key: 'key', docs: organizerCategories },
  ];
  for (const { collection, key, docs } of sets) {
    const coll = mongoose.connection.collection(collection);
    for (const doc of docs) {
      await coll.updateOne(
        { [key]: doc[key] }, // natural key
        { $setOnInsert: { ...doc, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true },
      );
    }
    console.log(`✓ ${collection} seeded (${docs.length})`);
  }
}

async function seedOrganizerServicesConfig() {
  const sets: Array<{ collection: string; docs: Record<string, unknown>[] }> = [
    { collection: 'experience_ranges', docs: experienceRanges },
    { collection: 'team_sizes', docs: teamSizes },
    { collection: 'languages', docs: languages },
    { collection: 'travel_options', docs: travelOptions },
    { collection: 'payment_methods', docs: paymentMethods },
    { collection: 'working_days', docs: workingDays },
    { collection: 'document_types', docs: documentTypes },
  ];
  for (const { collection, docs } of sets) {
    const coll = mongoose.connection.collection(collection);
    for (const doc of docs) {
      await coll.updateOne(
        { key: doc.key },
        { $setOnInsert: { ...doc, createdAt: new Date(), updatedAt: new Date() } },
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
      $setOnInsert: {
        key: 'customer-home',
        data: customerHomeContent,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  await coll.updateOne(
    { key: 'customer-plan' },
    {
      $setOnInsert: {
        key: 'customer-plan',
        data: customerPlanContent,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
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

// ---- demo quotes (per-user) ----
// Creates one submitted quote request for the demo customer plus two real
// quotations (from seeded organizers) so the /quotes compare screen has live,
// MongoDB-backed data to render. Gated on SEED_DEMO_PHONE like the others.
async function seedDemoQuotes() {
  const phone = process.env.SEED_DEMO_PHONE;
  if (!phone) return;
  const users = mongoose.connection.collection('users');
  const user = await users.findOne({ phone });
  if (!user) return;

  const organizersColl = mongoose.connection.collection('organizer_profiles');
  const orgA = await organizersColl.findOne({ name: 'Sharma Events' });
  const orgB = await organizersColl.findOne({ name: 'Mangala Celebrations' });
  if (!orgA || !orgB) {
    console.log('• skipped demo quotes — seed organizers first.');
    return;
  }

  const requests = mongoose.connection.collection('quote_requests');
  const quotations = mongoose.connection.collection('quotations');

  const reqKey = { customer: user._id, occasion: 'Wedding', when: '28 Dec' };
  await requests.updateOne(
    reqKey,
    {
      $set: {
        ...reqKey,
        organizer: null,
        where: 'Banjara Hills, Hyderabad',
        guests: '300',
        status: 'quoted',
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  const request = await requests.findOne(reqKey);
  if (!request) return;

  const makeLines = (food: number, water: number, decor: number, photo: number) => [
    {
      key: 'food',
      title: 'Food / Catering',
      subtitle: '300 plates',
      price: food,
      note: 'Menu customisable at the tasting.',
      subItems: [
        { label: 'Veg deluxe thali', value: `300 × ₹${Math.round(food / 300)}` },
        { label: 'Welcome drinks', value: 'Included' },
      ],
    },
    {
      key: 'water',
      title: 'Drinking Water',
      subtitle: '400 bottles',
      price: water,
      note: '',
      subItems: [{ label: 'Branded 500ml bottles', value: `400 × ₹${Math.round(water / 400)}` }],
    },
    {
      key: 'decoration',
      title: 'Decoration',
      subtitle: 'Theme & florals',
      price: decor,
      note: '',
      subItems: [
        { label: 'Stage & mandap', value: 'Included' },
        { label: 'Fresh florals', value: 'Marigold & rose' },
      ],
    },
    {
      key: 'photography',
      title: 'Photography & Video',
      subtitle: 'Full coverage',
      price: photo,
      note: '',
      subItems: [{ label: 'Candid + traditional', value: '2 shooters' }],
    },
  ];

  const build = (org: typeof orgA, lines: ReturnType<typeof makeLines>) => {
    const subtotal = lines.reduce((s, l) => s + l.price, 0);
    const taxAmount = Math.round(subtotal * 0.18);
    return {
      request: request._id,
      organizer: org._id,
      customer: user._id,
      lineItems: lines,
      subtotal,
      taxRate: 18,
      taxAmount,
      grandTotal: subtotal + taxAmount,
      notes: '',
      status: 'sent',
    };
  };

  const seeds = [
    build(orgA, makeLines(105000, 6000, 45000, 35000)),
    build(orgB, makeLines(98000, 5600, 41000, 33000)),
  ];
  for (const q of seeds) {
    await quotations.updateOne(
      { request: q.request, organizer: q.organizer },
      { $set: { ...q, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  }
  console.log(`✓ demo quotes (1 request · ${seeds.length} quotations) attached to ${phone}`);
}

async function main() {
  // Demo data must never reach a real database.
  if (process.env.NODE_ENV === 'production' || /prod/i.test(MONGO_URI as string)) {
    console.error(
      'Refusing to run the DEMO seed against production. Use `npm run seed:config` there.',
    );
    process.exit(1);
  }
  if (!process.argv.includes('--yes')) {
    console.error(
      'This adds SAMPLE packages and organizers (fake data). Re-run with `npm run seed:demo -- --yes`\n' +
        'if this database is for development. For real setup data only, use `npm run seed:config`.',
    );
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI as string);
  console.log('connected to MongoDB');
  await seedPackages();
  await seedOrganizers();
  await seedContent();
  await seedPlanConfig();
  await seedOrganizerConfig();
  await seedOrganizerServicesConfig();
  await seedDemoUser();
  await seedDemoBooking();
  await seedDemoNotifications();
  await seedDemoQuotes();
  await mongoose.disconnect();
  console.log('done.');
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
