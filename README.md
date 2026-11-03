# uwuShooty

Four games of aim against the wind: Archery, Darts, Hoops and Kicks. Every
shot is flown through real physics, pushed by the wind on that shot, and
aimed by hands that sway, and sway more on the shots that decide the
match. Play the bot at Easy, Medium or Hard, or a friend on the same
device or the same wifi. Every match has a seed that can be copied and
played again, an instant replay that can be stepped through shot by shot,
a replay link to share, and each game has its own leaderboards.

Live at <https://shooty.uwuapps.org>. A PWA drawn with three.js: once
opened, it plays offline.

## What runs where

| Part | Runs on |
| --- | --- |
| `main-site/`, the PWA and its API (`main-site/api/`) | Vercel, root directory `main-site` |
| Database, `uwushooty_*` tables | The shared uwuapps Supabase project |
| Matches between two devices | Browser to browser over WebRTC. PeerJS's public broker introduces the devices; nothing of ours is in between |

There is nothing on the VPS.

## Layout

```text
README.md
docs/            the specs this is built to
migrations/      SQL to run in the Supabase SQL editor, in number order
scripts/         pre-deploy checks and the tests
main-site/       the site Vercel deploys, including api/
```

`docs/` holds `uwuapps-theme.md` and `uwuapps-retrofit-time-mode.md` (the
theme, with time-based mode), `update-bar-spec.md` (the update prompt),
`edge-tray-spec.md` (the tray of buttons top right) and
`STUN-p2p-spec.md` (two devices on one network). `main-site/README.md`
covers the app itself.

## First setup

1. Run every file in `migrations/`, in number order, in the Supabase SQL
   editor of the shared uwuapps project.
2. On the Vercel project (root directory `main-site`), set the variables in
   `main-site/.env.example`: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
3. Add the domain `shooty.uwuapps.org` to the Vercel project.
4. Deploy.

Without the variables the site still plays in full; the API answers
`not_configured`, every match says it is not scored, and shared replays
use long links.

## Migrations

**Never edit a file once it has been run.** Every change to the schema is a
new file with the next number. Each file is safe to run again.

| File | What it does |
| --- | --- |
| `001_uwushooty_schema.sql` | Matches (the start tickets), the leaderboard and its best and total views per game, the short replay links, rate limits, and the finish, submit and prune functions. |

Every table has row level security on with no policies. Only the service
role key, used by the Vercel functions, can read or write, and only it can
call the functions.

## Before every deploy

1. Bump `VERSION` in `main-site/sw.js`. Without it, returning visitors keep
   the previous build and never see the update bar.
2. Run the checks, from the repo root, with Node 20 or later and nothing to
   install:

```text
node scripts/check-sw.mjs          # the worker only activates when asked
node scripts/check-precache.mjs    # everything the app loads works offline
node scripts/check-theme.mjs       # pre-paint script matches js/theme.js
node scripts/check-p2p.mjs         # pairing is STUN only, no TURN relay
node scripts/test-sim.mjs          # every game plays, ends, and replays to the same score
node scripts/test-verify.mjs       # the API's check on a match, without a database
```

**If you change `js/sim.js`, any `js/sim-<game>.js`, `js/sim-shared.js`,
`js/physics.js`, `js/fmath.js`, `js/rules.js`, `js/seed.js` or
`js/record.js`,** matches played on the old build change with them: matches
still open in someone's tab stop verifying, since the API plays every match
again with the code it has now, and old replay links play out differently.
Bump `RULES_VERSION` in `js/rules.js` for any change that alters how a
record plays or scores.

## The physics is the same everywhere

The API checks a score by playing the match again, so a shot has to fly
the same way on the server as it did in the browser, to the bit. The
physics runs in fixed steps and uses only the operations JavaScript rounds
exactly (`+ - * /` and `Math.sqrt`); sine, cosine and arctangent are
`js/fmath.js`'s own, built from those, because `Math.sin` and friends may
differ in the last bit between engines. Randomness is `js/seed.js`'s,
from the seed, never `Math.random`.

## Leaderboard integrity

A browser game cannot prove its score. What the API does instead, with
`main-site/api/_lib/verify.js` and the SQL functions, is refuse a match
real play could not have made:

- only matches against the bot, started online: the start ticket's time is
  the server's, and so is the seed, so nobody can work the match out ahead
- the score is worked out from the shots by playing the match again; a
  record that does not make a finished match is refused
- a match that ran faster than the server's clock
- shots quicker than a hand, more than now and then: an arrow loosed a
  quarter second after drawing, darts stopped faster than a tap
- precision no person has: arrows grouped tighter than an Olympic archer's
  in wind, nearly every dart in a treble, double or bull, nearly every shot
  a swish
- a match from another browser, a second ending, or one played at the same
  time as another under the same name

A match on a seed somebody typed in, or against a friend, is never sent.
This bounds cheating; it does not prevent it.

## Sounds

The impacts, the crowd, the swish, the rim, the bounce, the post and the
whistle are short clips from [myinstants.com](https://www.myinstants.com),
trimmed and normalised (`main-site/sounds/`). Clips ripped from games or
films were left alone; these are general sound effects, but myinstants is
user uploaded and gives no licence, so check them before relying on them.
The kick is stack-game's `SoccerKick.wav`. The bowstring, the bow's creak,
the wind and the heartbeat are synthesised in `js/audio.js`.
