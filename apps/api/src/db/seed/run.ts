/**
 * Seed the global catalogues (equipment + exercises).
 *
 * Idempotent: safe to re-run after adding rows to the seed files. Equipment is keyed on
 * `slug`, exercises on `(user_id, name_en)` with user_id NULL — both have matching unique
 * constraints, so conflicting rows are updated rather than duplicated.
 *
 * Requires the DIRECT Supabase connection (port 5432), not the pooler.
 *
 *   DATABASE_URL="postgres://...:5432/postgres" npm run db:seed --workspace @fit/api
 */

import { EQUIPMENT_SEED, EXERCISE_SEED } from '@fit/shared/catalog';
import { sql } from 'drizzle-orm';

import { createDb } from '../client.js';
import { equipment, exercises } from '../schema.js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Use the direct connection URL (port 5432).');
    process.exit(1);
  }

  const { db, client } = createDb({ url, mode: 'direct' });

  try {
    console.log(`Seeding ${EQUIPMENT_SEED.length} equipment rows...`);
    await db
      .insert(equipment)
      .values(EQUIPMENT_SEED.map((e) => ({ slug: e.slug, nameEn: e.nameEn, nameHe: e.nameHe })))
      .onConflictDoUpdate({
        target: equipment.slug,
        set: {
          nameEn: sql`excluded.name_en`,
          nameHe: sql`excluded.name_he`,
        },
      });

    // Resolve equipment slugs to ids in one query rather than per exercise.
    const rows = await db.select({ id: equipment.id, slug: equipment.slug }).from(equipment);
    const idBySlug = new Map(rows.map((r) => [r.slug, r.id]));

    const missing = EXERCISE_SEED.filter((e) => !idBySlug.has(e.equipmentSlug));
    if (missing.length > 0) {
      // Should be unreachable — seed.test.ts asserts this — but failing loudly beats
      // inserting exercises with a null equipment_id that then never match substitution.
      throw new Error(
        `Unknown equipment slugs: ${missing.map((e) => `${e.nameEn} -> ${e.equipmentSlug}`).join(', ')}`,
      );
    }

    console.log(`Seeding ${EXERCISE_SEED.length} global exercises...`);
    await db
      .insert(exercises)
      .values(
        EXERCISE_SEED.map((e) => ({
          userId: null, // NULL = global, readable by everyone, editable by nobody
          nameEn: e.nameEn,
          nameHe: e.nameHe,
          primaryMuscle: e.primaryMuscle,
          secondaryMuscles: e.secondaryMuscles ?? [],
          movementPattern: e.movementPattern,
          equipmentId: idBySlug.get(e.equipmentSlug) ?? null,
          isUnilateral: e.isUnilateral ?? false,
          loadType: e.loadType ?? 'weight_reps',
        })),
      )
      .onConflictDoUpdate({
        target: [exercises.userId, exercises.nameEn],
        set: {
          nameHe: sql`excluded.name_he`,
          primaryMuscle: sql`excluded.primary_muscle`,
          secondaryMuscles: sql`excluded.secondary_muscles`,
          movementPattern: sql`excluded.movement_pattern`,
          equipmentId: sql`excluded.equipment_id`,
          isUnilateral: sql`excluded.is_unilateral`,
          loadType: sql`excluded.load_type`,
        },
      });

    const [equipmentCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(equipment);
    const [exerciseCount] = await db.select({ n: sql<number>`count(*)::int` }).from(exercises);

    console.log(
      `Done. equipment=${equipmentCount?.n ?? '?'} exercises=${exerciseCount?.n ?? '?'}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
