# Google Play Console — what to answer, form by form

For JustFit 1.0.0 (`com.afeka.fitapp`, version code 2). Every answer is checked against the code
and the privacy policy as of that version; if the app changes what it collects or sends, this
file and the Data safety form change with it. Play Console is the account owner's — these are
answers to paste or choose, not steps anyone else can take.

## Before anything else

- **Account type:** a personal developer account created after 13 Nov 2023 must run a closed
  test with at least **12 testers, opted in for 14 days in a row**, before applying for
  production. Internal testing (up to 100 people) can start at once and does not count.
- **App signing:** choose *Use Google-generated key* (Play App Signing). Upload the bundle signed
  with the upload key on this machine (`~/.novafit/`). People who installed the shared APK will
  need to uninstall it once to move to the Play version.
- **Create app:** name `JustFit`, default language Hebrew (he-IL), App (not game), Free.

## Main store listing

Texts: `store/listing.md`. Graphics: run `bash store/render.sh` → `store/out/icon-512.png` and
`store/out/feature-graphic.png`. Phone screenshots: at least 2 (up to 8), from the phone itself,
cropped so neither side is more than twice the other (a 1080×2340 screenshot must be cut to
1080×2160) — prepared separately.

- **Category:** Health & Fitness
- **Contact email:** afekae90@gmail.com (shown publicly on the listing)
- **Privacy policy:** https://afekae70.github.io/fit-app/privacy/

## App content

### Privacy policy

https://afekae70.github.io/fit-app/privacy/

### App access

*All or some functionality is restricted* — the app needs an account. Give the reviewers a test
account made for them (an email you control, not your own account), signed in once on a phone so
its profile is filled in, with a few workouts and meals logged. Instructions to paste:

> Sign in with the email and password below. The fingerprint lock is off unless turned on in
> Settings. The progress-photos screen asks for a fingerprint only on a phone that has one
> enrolled; without one it opens directly. The AI coach and meal scan need an internet
> connection.

### Ads

No, the app does not contain ads.

### Content rating (IARC questionnaire)

- Category: **All other app types**
- Violence, sexuality, language, controlled substances, gambling: **No** to all
- Users can interact or exchange content: **Yes** — only between a trainee and the coach the
  trainee connected to by code (training plans, notes, and what the trainee chose to share)
- Shares the user's location with others: **No**
- Digital purchases: **No**
- Generates content with AI: **Yes** — text answers from the AI coach; users can report any
  answer in the app. The AI features are for 18 and over only (see Target audience).

### Target audience and content

- Target age groups: **16–17** and **18 and over** (decided by the user, 2026-10-24).
  - Sign-up's age ruler starts at 16, and the privacy policy says "16 and over".
  - The free Gemini API behind the coach, the daily note, the weekly review and the meal scan
    is for adults only. So those four are closed under 18: the server function reads the
    caller's date of birth from their own profile row and refuses (403 `age_restricted`, or
    `age_unknown` with no date) before anything is counted or sent to Google. The app hides the
    same features, using the same rule (`aiAgeVerdict` in `packages/shared`).
  - Nothing in the app is aimed at children, so the Families policy does not apply (it covers
    audiences under 13).
- Appeals to children: **No**

### News app

No.

### Data safety

Data collection and security:

- Collects or shares any of the required data types: **Yes**
- All data encrypted in transit: **Yes** (HTTPS to Supabase and to the app's server function)
- Users can request that data be deleted: **Yes** — in the app (Settings → Account → Delete
  account) and at https://afekae70.github.io/fit-app/privacy/#delete

Data types — **collected** means stored in the user's account; **shared** means sent to a third
party (Google, through the Gemini API behind the AI coach and meal scan). A trainee's data seen
by the coach they connected to is not "sharing" in Play's sense: it is the user's own action,
done on purpose. No data is used for advertising or analytics, and none is sold.

| Play data type | What it is in JustFit | Collected | Shared (Google Gemini) | Required? | Purpose |
|---|---|---|---|---|---|
| Personal info → Name | Display name | Yes | No | Optional | App functionality |
| Personal info → Email address | Sign-in email | Yes | No | Required | Account management, App functionality |
| Personal info → User IDs | Account id | Yes | No | Required | Account management |
| Personal info → Other info | Date of birth, sex, height, activity level, goal | Yes | Yes (summary for the AI coach) | Optional | App functionality |
| Health and fitness → Health info | Weight, body fat and other body measurements; food log, water | Yes | Yes (summary for the AI coach) | Optional | App functionality |
| Health and fitness → Fitness info | Workouts, sets, cardio, training plans and calendar | Yes | Yes (summary for the AI coach) | Optional | App functionality |
| Photos and videos → Photos | Profile picture, progress photos (stored); meal photos for the scan (sent to Google, not stored — mark *processed ephemerally*) | Yes | Yes (meal photos only) | Optional | App functionality |
| Messages → Other in-app messages | Questions typed to the AI coach (sent to Google, not stored); workout notes between trainee and coach (stored); reported AI answers (stored) | Yes | Yes (AI coach questions only) | Optional | App functionality |

Not collected: location, financial info, contacts, calendar, files, audio, web history, app
activity/analytics, crash logs, device or advertising IDs.

### Health apps declaration

Features: **Activity and fitness** (workout tracking), **Nutrition and weight management** (food,
water, body weight). Not a medical device; no diagnosis or treatment.

Health Connect — write only, no read permissions:

| Permission | Why |
|---|---|
| WRITE_EXERCISE | When a workout is finished, it is saved to Health Connect as an exercise session, if the user turned this on in Settings. |
| WRITE_DISTANCE | The distance of a finished cardio session (running, walking, cycling) is saved with that session. |
| WRITE_ACTIVE_CALORIES_BURNED | The estimated calories of a finished workout are saved with that session. |

### Government apps / Financial features / Health research

No / None / No.

### Advertising ID

No — the app declares no advertising ID permission and uses none.

