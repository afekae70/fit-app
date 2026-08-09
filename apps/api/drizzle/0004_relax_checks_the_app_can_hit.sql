-- Three CHECK constraints the app can legitimately violate, each of which stops sync completely.
--
-- The first was not theoretical: `sets_has_measurement_check` rejected the very first real sync,
-- with "new row for relation sets violates check constraint". The other two were found by reading
-- every remaining CHECK on the synced tables against what the app can actually produce, rather
-- than waiting to discover them the same way.
--
-- Why this matters more than the individual rows: a rejected row fails its whole batch, the push
-- throws, and the cursor deliberately does not advance — so the next sync sends the same rows and
-- fails identically. One unacceptable row does not degrade sync, it *ends* it, permanently and
-- for every table. That is the right behaviour when the alternative is silently dropping the
-- user's data, but it means a constraint the client cannot satisfy is not a data-quality
-- safeguard, it is an outage.
--
-- In each case the app's model is the one that reflects how the app is actually used, so the
-- server yields.

------------------------------------------------------------------------- blank sets are real
-- The constraint requires reps, duration or distance. The app creates a set the moment an
-- exercise is added to a session — empty, waiting to be filled in — and that is the entire point
-- of the row: it is the thing you type into. It is also what makes the set list appear before you
-- have lifted anything. The server's own comment said this guarded against "an offline client
-- syncing empty rows"; those empty rows are a workout in progress.
ALTER TABLE "sets" DROP CONSTRAINT IF EXISTS "sets_has_measurement_check";

--------------------------------------------------------------- clocks move, workouts do not
-- `ended_at >= started_at` is true of every real workout and can still be false on the row. The
-- phone stamps both from its own clock, and an NTP correction between the first set and the last
-- can move that clock backwards underneath a session that is genuinely in progress. Rare, and
-- permanent when it happens: that session can never sync, so nothing else can either.
ALTER TABLE "workout_sessions" DROP CONSTRAINT IF EXISTS "workout_sessions_time_order_check";

------------------------------------------------------------------ a scale can talk nonsense
-- Body fat is required to be under 100%. Nothing in the app enforces that, because the number
-- comes off a bluetooth scale: a bad frame, a foot lifted mid-reading, a device the parser has
-- only been half-guessed at. Storing an implausible reading is a cosmetic problem on one row of
-- one chart. Rejecting it costs the user every future sync of every table.
ALTER TABLE "body_metrics" DROP CONSTRAINT IF EXISTS "body_metrics_body_fat_check";

-- Left in place deliberately:
--   plans_days_per_week_check and plan_day_exercises_rpe_check both guard columns the app never
--   writes and does not sync, so they can only ever see NULL from this client and are free.
