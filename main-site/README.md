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
| `vendor/three/` | three.js r187, with its licence, vendored so it is precached and every game draws offline: the build, and the post-processing passes High graphics uses (`examples/jsm/`, unchanged from the same release). |
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
| `sim-shared.js` | The weather, the wind, the sway of a hand, the arm tiring, and the pressure on a shot. |
| `sim.js` | A match as data: turns, the bot's turns, timing, points, and playing a record back. |
| `sim-archery.js`, `sim-darts.js`, `sim-hoops.js`, `sim-kicks.js` | Each game's rules, sizes, bot and flight. |
| `record.js` | A match as it is kept, sent and shared, and the token a long replay link carries. |
| `scene.js` | The three.js stage, its materials and outlines, the light, the wind's motes (soft round dots on High), High graphics' post-processing (MSAA, god rays, bloom, SMAA), and the 4K capture. |
| `godrays.js` | High graphics' god rays, after stack-game's: light shafts fanning out of the open sky past the trees, clouds and goal, towards the sun, and a lens flare over them; faint at dusk, nearly gone in the rain, none indoors. |
| `scene-props.js` | Trees, hills, clouds and the wind flags. |
| `weather.js` | When lightning flashes and thunder rolls in a wet match, from the seed and the game clock, so a replay storms the same. |
| `scene-weather.js` | The weather drawn: the grey sky and dark rain cloud, the drops and their splashes and ripples on the GPU, bigger splashes where things land, the wet ground and puddles, the forked lightning, and the stars on a clear night. |
| `scene-archery.js`, `scene-darts.js`, `scene-hoops.js`, `scene-kicks.js` | Each game's world, and its aiming layer: reticles, sweeps, the power meter, the drag. |
| `controls.js` | Each game's hands: how a press, a drag or a tap becomes a shot, and how a turn's aim looked, for the replay. |
| `game.js` | The screens, the match loop, the scoreboard, the result, submitting, seeds, sharing and shared replays. |
| `replay.js` | The instant replay's clock and controls. |
| `shot.js` | The replay's 4K picture: the caption band and the download, after stack-game's. |
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
the rim and the glass. The hoop stays still on every difficulty (matches
recorded before rules 3 had it drift side to side on Hard, and their
replays still do).

**Kicks.** A penalty shootout, 3, 5 or 7 kicks each, then sudden death; it
ends early once one side cannot be caught. Drag from the ball to where you
want it on the goal and flick: a faster flick strikes harder, which gives
the keeper less time but spreads the shot; a drag that bows to one side
curls the ball that way. Against the bot you keep goal for its kicks: tap
where to dive. Dive too early and a good bot sees it and goes the other
way. Between two people the computer keeps goal for both.

**The computer in goal** keeps goal the way a real keeper faces a
penalty. A kick reaches the line in 0.35 to 0.65 s, and a keeper needs
about 0.2 s to react and 0.6 s or more to dive to a corner, so against a
well struck kick it cannot wait to see the ball: it commits, a moment
before the strike, on what the kicker's run up gives away, and the better
the keeper the more often it reads the right side and the closer it gets
to where the ball is going. Against a soft kick, with time to watch it, it
reacts to the ball's first flight and goes for where that says it will
cross, which a curling or wind blown kick can still beat. And though
keepers nearly always dive (most kicks go to the sides), the good ones
stand up to a kick down the middle. Its skill is the difficulty's:

| | Reads the side | Reaction | Dive | Stands up to the middle |
| --- | --- | --- | --- | --- |
| Easy | 50%, a guess | 300 ms | 3.4 m/s | 35% |
| Medium | 60% | 240 ms | 4.0 m/s | 60% |
| Hard | 66% | 200 ms | 4.5 m/s | 85% |

Against a stand-in kicker it saves about one firm kick in ten on Easy,
one in five on Medium and one in four on Hard, more of the soft ones and
the ones down the middle; corners are the hardest to save, as they are.
Before rules 2 the keeper guessed blindly or read the kick outright;
those old matches still play with it.

**Rain, outdoors.** Archery, Hoops and Kicks are played outside, and the
seed decides the weather for the whole match: one match in five is in
light rain, with the odd roll of distant thunder (6 to 15 km off, so a
rumble, half a minute after a glow on the clouds); on Hard three in five
are, and that is a thunderstorm, heavier, with a strike every ten seconds
or so under 6 km away, the bolt in sight and the crack close behind (the
thunder comes about 2.9 s after the flash for every kilometre, the speed of
sound). Darts is indoors and stays dry. A deck of dark rain cloud comes
over and the sky greys. The rain is drawn to scale and the way stack-game
draws it, every drop a streak worked out on the GPU: drops of about 1 mm
falling at about 4 m/s in light rain and 2 to 3 mm at about 7 m/s in a
storm, carried sideways at the wind's speed, so in a strong wind the rain
slants hard. On High every drop splashes where it lands, a crown of
droplets for a fifth of a second, and rings spread across the puddles (and
faintly across the court's film of water) at about 24 cm/s, the slowest a
ripple on water can travel. A ball bouncing, an arrow burying itself or a
keeper landing from a dive throws up a spray of droplets and sends out
bigger, faster rings, with a splash you can hear. Lightning is a forked
bolt brighter than white, which the bloom spreads into a glow. A chip says
it is wet, and everything is slippery, which makes the game a little
harder:

| Game | What the rain does |
| --- | --- |
| Archery | The grip and the footing are slick, so the reticle sways 7% more in light rain and 12% in a storm; wet fletching drags a little more than the bow is sighted for, so arrows sit a touch low and the wind has longer to push them. |
| Hoops | A wet ball slips in the hand, so aim and pull wander 5 to 8% more; off a wet rim and glass it skids instead of gripping, and off the court it comes up lower and slides on. |
| Kicks | The standing foot slides, so kicks spread up to 35% more; the ball skids on off the wet grass, squirts off the keeper's gloves instead of sticking, and the keeper pushes off the turf a little slower. |

Rain also adds to the pressure on every shot (0.05 in light rain, 0.08 in
a storm), so the heart runs faster and the hands shake more, and since
pressure scales points, a wet shot that goes in is worth a little more.
The bot plays in the same rain. In the stand-in tests a wet match scores
about 7% less in Archery, 10 to 13% less in Hoops and 2% less in Kicks.

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

**Seeds.** Every match has one, such as `BXK4-M9TR`. It decides the weather, the wind on
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

**A picture.** The camera button in the replay's controls (or P) saves a
picture of the moment showing, as stack-game does: drawn at 4K, 3840 pixels
along the longer side (held to 4K UHD's pixel count in all, and about 6
megapixels on a phone), in the graphics quality picked, with nothing of the
page over it. A frosted band along the bottom gives the player's name, how
the match went and the score, the game, difficulty, length, weather, seed
and day, and uwuShooty's icon and address; the view is zoomed out just
enough that all the screen showed sits above the band. It goes straight
into the browser's downloads.

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
| Graphics | High | High draws through post-processing: 4x MSAA, god rays and a lens flare from the sky outdoors, a soft bloom on anything brighter than white (lightning above all), and SMAA. Low draws one pixel per CSS pixel, no shadows and no post-processing. |

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
