# main-site

What Vercel deploys, served at <https://shooty.uwuapps.org>. No build step:
the files are served as they are, and `api/` holds the serverless functions.

| Path | What it is |
| --- | --- |
| `index.html` | The only page. Its `<head>` is the template for any page added later. |
| `404.html`, `404.css` | The shared not-found page. |
| `sw.js` | Service worker: the offline shell, and the update bar's waiting worker. |
| `manifest.json` | PWA manifest. Opens full screen when installed. |
| `UST-main.png`, `UST-192.png`, `UST-512.png`, `favicon.ico` | The app icon. Everything sits inside the circle a launcher crops to, so the 512 doubles as the maskable icon. |
| `tile.png`, `tile-wide.png`, `browserconfig.xml` | Windows tiles, from the same icon. |
| `css/theme.css` | The uwuapps theme, verbatim from `docs/uwuapps-theme.md`, time-based mode included. |
| `css/style.css` | Layout: the full-bleed game, the scoreboard, the sheets and the Edge Tray. |
| `js/` | ES modules, below. |
| `vendor/three/` | three.js r187, with its licence, vendored so it is precached and every game draws offline. |
| `sounds/` | The recorded sounds; see the root README for where they came from. |
| `api/` | The API, below. |
| `images/` | Manifest screenshots, at the sizes `manifest.json` gives. Placeholders until real ones replace them. |

## js

Every file here is precached; `scripts/check-precache.mjs` fails if one is
not. The first group is pure, with no DOM, and the API imports it too, so
the browser and the server always agree on a match.

| File | What it does |
| --- | --- |
| `fmath.js` | Sine, cosine and arctangent built from exactly rounded operations, so every engine agrees. |
| `seed.js` | Seeds, and the random numbers a match draws from. |
| `rules.js` | The settings (difficulty, length, shot clock, mode), the timing every turn shares, the nerves, and scoring. |
| `physics.js` | Flight in fixed steps: gravity, drag against moving air, spin; aiming; bounces. |
| `sim-shared.js` | The wind, the sway of a hand, the arm tiring, and the pressure on a shot. |
| `sim.js` | A match as data: turns, the bot's turns, timing, points, and playing a record back. |
| `sim-archery.js`, `sim-darts.js`, `sim-hoops.js`, `sim-kicks.js` | Each game's rules, sizes, bot and flight. |
| `record.js` | A match as it is kept, sent and shared, and the token a long replay link carries. |
| `scene.js` | The three.js stage, its materials and outlines, the light, and the wind's motes. |
| `scene-props.js` | Trees, hills, clouds and the wind flags. |
| `scene-archery.js`, `scene-darts.js`, `scene-hoops.js`, `scene-kicks.js` | Each game's world, and its aiming layer: reticles, sweeps, the power meter, the drag. |
| `controls.js` | Each game's hands: how a press, a drag or a tap becomes a shot, and how a turn's aim looked, for the replay. |
| `game.js` | The screens, the match loop, the scoreboard, the result, submitting, seeds, sharing and shared replays. |
| `replay.js` | The instant replay's clock and controls. |
| `party.js` | Playing a friend: on one device, or on two over `net.js`. |
| `net.js` | Pairing over PeerJS, STUN only, from `docs/STUN-p2p-spec.md`, after stack-game's and uwuPromptr's. |
| `qr.js` | QR encoder for the join link, from uwuPromptr, so it works offline. |
| `audio.js` | Every sound: the recordings, and the synthesised bowstring, wind and heartbeat. |
| `tray.js` | The Edge Tray (`docs/edge-tray-spec.md`). |
| `api.js`, `leaderboard.js`, `settings.js` | The API client, and the leaderboard and settings windows, after MRT Station Guesser's. |
| `theme.js`, `icons.js`, `ui.js`, `update-bar.js`, `app.js` | Theme, inline SVG icons, modal and storage helpers, the update bar, and boot. |

## The games

Pick a game, a difficulty, a match length and a shot clock, and play the
bot or a friend. The players take turns; the bot's shots are drawn from the
seed, so a replay of a match has the same bot.

**Archery.** Three arrows each a round, 3, 5 or 7 rounds, on a World
Archery 122 cm face; the target walks back every round (15 to 30 m on Easy,
25 to 50 on Medium, 40 to 70 on Hard). Press and hold to draw, drag to aim,
let go to loose. The bow is sighted for the distance, so in still air an
arrow lands where the reticle is; the wind is the part to allow for. A
ring round the reticle fills as the draw is held, and turns red after four
seconds, when the arm starts to tire and the sway grows. Ties go to the
most Xs, then tens. The keyboard works too: hold Space, aim with the arrows.

**Darts.** Count down from 101, 301 or 501, three darts a visit, the last
dart landing the exact score; under zero is a bust. Tap to stop the side to
side sweep, tap again to stop the up and down one (Space or Enter work).
The sweeps carry the hand's tremor, and the throw adds a little more. The
board is a regulation one at the regulation height. After thirty visits
each, the nearer zero wins.

**Hoops.** Five spots round the arc each round, 2, 3 or 4 rounds, further
out every round; both players shoot from each spot. Press, pull back for
power and to the side to aim the other way, and let go. Two inside the
6.75 m line, three beyond, and a point more for a swish. The ball comes off
the rim and the glass. On Hard the hoop drifts slowly side to side.

**Kicks.** A penalty shootout, 3, 5 or 7 kicks each, then sudden death; it
ends early once one side cannot be caught. Drag from the ball to where you
want it on the goal and flick: a faster flick strikes harder, which gives
the keeper less time but spreads the shot; a drag that bows to one side
curls the ball that way. Against the bot you keep goal for its kicks: tap
where to dive. Dive too early and a good bot sees it and goes the other
way. Between two people the computer keeps goal for both.

**Wind, accuracy and nerves, in every game.** Every shot has its own wind,
shown as a chip with its speed and an arrow (up is down the range), as
motes drifting through the scene, and as flags. A shot flies with drag
against the moving air, so the wind pushes it as much as it would push the
real thing: a fast arrow a little, a slow ball a lot. Every aim sways, from
the body's drift, breathing, the hand's tremor and a kick on every
heartbeat. The pressure on a shot (how late in the match, how close the
score, whether it can win or lose it, how tight the clock) raises the
heart rate, shown on its own chip and heard on the big shots, and makes the
sway up to 2.6 times larger. The bot feels it too: its spread widens under
pressure, and how much of the wind it allows for depends on its difficulty.
On Easy, a setting shows aim guides: where the wind will take an arrow, and
the power band that drops a still air shot in.

## Scoring

The score grows as the match goes on. Each shot scores its game's points:

| Game | Points |
| --- | --- |
| Archery | 10 a ring, 5 more for an X |
| Darts | what the dart scores, 50 more for the dart that finishes; nothing for a bust |
| Hoops | 50 for two, 75 for three, 25 more for a swish |
| Kicks | 60 a goal, 30 more in a top corner, 60 a save |

Each shot's points are then scaled by the round (8% more each round), the
shot clock (Off 100%, 10 s 110%, 5 s 125%, 3 s 150%), the wind (up to 40%
more at the strongest the difficulty blows) and the pressure (up to 30% more
on the shot that decides it). The match's total is scaled by the difficulty
(75%, 100%, 150%) and the length (100%, 115%, 130%), and beating the bot
adds a quarter, drawing a tenth.

## Seeds, replays and sharing

**Seeds.** Every match has one, such as `BXK4-M9TR`. It decides the wind on
every shot, every one of the bot's shots, the sway, the archery distances
and the hoops spots. It shows on the result, with Copy and Play it; paste
one into a game's panel to play that match again. A match on a typed seed
is not scored.

**Instant replay.** When a match ends it plays itself back (a setting turns
this off): the aim with its sway, every flight and every landing, with the
scoreboard as it stood and a line saying what happened. Play and pause, a
step back or forward one shot at a time, a timeline, and 0.5x, 1x, 2x or 4x
as in Word Rain, the speed picked last remembered. Space and the arrow keys
work too. On a narrow screen the panel folds to its controls while the
replay runs.

**Sharing.** Share replay makes a link, through the device's share sheet
where it has one and the clipboard otherwise. Online it is a short link,
`/r/Xk3m9QaB`, stored by the API; one for a match the API started is copied
from the server's own record and marked checked. Offline, or if the API is
unavailable, the link carries the whole match instead, `/?watch=...`, as
chess-game's do, and opens offline once the site has been visited.

## Playing a friend

**On this device.** Two names, and the device is passed between you; the
intro gives a moment to hand it over when the shooter changes.

**On two devices,** per `docs/STUN-p2p-spec.md`: STUN only, no TURN relay.
**Both devices have to be on the same network**: the same wifi, or one
sharing a hotspot with the other. PeerJS loads from cdnjs only when somebody
hosts or joins, and is never cached. One device hosts with a six character
code, a link (`/join?id=CODE`) or a QR code, and the other joins. The match
is the host's game and settings on a fresh seed. The host's device referees:
it plays every shot through `js/sim.js` and sends the other device the
record and its clock 20 times a second, which is also the heartbeat; each
device sends its shots, and its hands while it aims, so each sees the other
aim live.

Matches with a friend never go on the leaderboard.

**Privacy:** between two devices each learns the other's public IP
address, as any peer-to-peer connection does, and PeerJS's broker sees peer
ids and IP addresses, never the match. The privacy policy should say so.

## Settings

Kept in this browser, after MRT Station Guesser's:

| Setting | Default | What it does |
| --- | --- | --- |
| Leaderboard name | not set | Checked by `/api/leaderboard/name`. |
| Add finished matches automatically | off | Needs a name. |
| Play the replay when a match ends | on | |
| Show the aim guides on Easy | on | |
| Sound effects | on | Also the button at the top of the tray. |
| Hear your heartbeat on the big shots | on | |
| Short buzzes | on | Where the device can vibrate. |
| Graphics | High | Low draws one pixel per CSS pixel and no shadows. |

Each game's difficulty, length and shot clock are remembered too.

## Leaderboards

Each game has two, after MRT Station Guesser's: each name's best match, and
every match under a name added up (with its matches and wins). See the root
README for what is checked.

## Offline and updates

Everything the page loads is precached, three.js and the sounds included, so
the site opens and plays with no connection, replays and long replay links
too. Only the leaderboards, short replay links and two-device matches need
the network. Nothing under `/api/` is ever cached.

A new service worker installs and waits. The update bar offers Reload or Not
now, and nothing reloads until the player asks
(`docs/update-bar-spec.md`). Bump `VERSION` in `sw.js` on every change to
anything in this directory.

## API

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/game/start` | `client_key, game, difficulty, length, clock` | `game_id, seed, created_at` |
| `POST /api/game/finish` | `game_id, client_key, record` | `elapsed_ms` |
| `POST /api/game/submit` | `game_id, client_key, name, record` | `name, score, result, elapsed_ms, rank, best_score, total, matches, total_rank` |
| `POST /api/leaderboard/name` | `name` | `name`, cleaned, or a `400` saying why not |
| `GET /api/leaderboard` | `?game=archery\|darts\|hoops\|kicks&board=best\|total` | `game, board, entries`, cached 30 s |
| `POST /api/replay/create` | `game_id, client_key, name?`, or `record, name?, played_at?` | `id`, for `/r/<id>` |
| `GET /api/replay` | `?id=` | `record, name, verified, created_at, played_at`, cached a day |

`record` is `js/record.js`'s shape. Errors are `{ error, message? }` with a
matching status: `400` bad input or name, `403` another browser's match,
`404` no such match, `409` refused (`not_this_game`, `bad_record`,
`unfinished`, `too_fast`, `inhuman`, `already_submitted`, `mismatch`,
`overlap`), `410` older than 12 hours, `429` too many requests. Start and
finish are limited to 120 an address per 10 minutes, submit and replay
create to 60.

## Environment variables (Vercel)

Documented in `.env.example`. `.vercelignore` keeps every env file out of
deployments, since anything in this directory would otherwise be served.

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` | The shared uwuapps project. |
| `SUPABASE_SERVICE_KEY` | Service role key. Server side only, never sent to a browser. |
