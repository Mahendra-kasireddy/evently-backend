"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('MONGO_URI is not set. Add it to .env first.');
    process.exit(1);
}
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
    const coll = mongoose_1.default.connection.collection('packages');
    for (const p of packages) {
        await coll.updateOne({ title: p.title }, { $set: { ...p, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    }
    const count = await coll.countDocuments();
    console.log(`✓ packages seeded (${packages.length} upserted, ${count} total)`);
}
async function main() {
    await mongoose_1.default.connect(MONGO_URI);
    console.log('connected to MongoDB');
    await seedPackages();
    await mongoose_1.default.disconnect();
    console.log('done.');
}
main().catch((err) => {
    console.error('seed failed:', err);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map