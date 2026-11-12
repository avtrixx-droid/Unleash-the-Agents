// Sanity + performance check for the matcher with 500 fake attendees.
// Run: npm run test:matcher
import { hashEmbed, runMatching, templateCopy, type Person } from "../supabase/functions/_shared/matcher.ts";
import { fakePeople } from "../supabase/functions/_shared/fake.ts";

const N = Number(process.argv[2] ?? 500);
const people: Person[] = fakePeople(N).map((p, i) => ({
  id: String(i),
  name: p.full_name,
  building: p.building,
  need: p.need,
  b: hashEmbed(p.building),
  n: hashEmbed(p.need),
}));

const t0 = performance.now();
const res = runMatching(people, [0, 1]);
const ms = performance.now() - t0;

const seen = new Map<number, number>();
for (const g of res.groups) for (const m of g.members) seen.set(m, (seen.get(m) ?? 0) + 1);
const missing = people.length - seen.size;
const dupes = [...seen.values()].filter((c) => c > 1).length;
const sizes = res.groups.reduce<Record<number, number>>((acc, g) => ((acc[g.members.length] = (acc[g.members.length] ?? 0) + 1), acc), {});

console.log(`people=${N} groups=${res.groups.length} sizes=${JSON.stringify(sizes)} clusters=${res.clusterCount} time=${ms.toFixed(0)}ms`);
console.log(`staged first: ${res.groups[0].staged} members=${res.groups[0].members}`);
for (const g of res.groups.slice(1, 4)) {
  const ms2 = g.members.map((i) => people[i]);
  console.log(`- ${ms2.map((p) => `${p.name} [builds: ${p.building} | needs: ${p.need}]`).join("  +  ")}`);
  console.log(`  ${templateCopy(ms2, 3).why}`);
}
if (missing || dupes) {
  console.error(`FAIL missing=${missing} dupes=${dupes}`);
  process.exit(1);
}
for (const n of [0, 1, 2, 3, 7]) {
  const r = runMatching(people.slice(0, n));
  const covered = new Set(r.groups.flatMap((g) => g.members)).size;
  if (covered !== n) {
    console.error(`FAIL small n=${n} covered=${covered}`);
    process.exit(1);
  }
}
console.log("OK: everyone matched exactly once");
