// Every sound. The rain and the thunder are recordings too, the rain
// looped under the match and each thunderclap played as far off as its
// strike: quieter, and duller, since air soaks up the high notes of a
// sound over distance far more than the low ones, which is why close
// thunder cracks and far thunder rumbles.
//
// The impacts, the crowd and the whistle are short recordings
// in /sounds/ (the kick is stack-game's, the rest are trimmed and
// normalised clips); the bowstring, the wind and the heartbeat are
// synthesised with Web Audio, so they can follow what is happening: the
// wind louder in a gale, the heart faster on the shot that matters.
//
// Nothing plays until the first tap, which is when a browser allows an
// AudioContext to start.

import { getSettings } from "./settings.js";

const FILES = {
  arrowWhoosh: "/sounds/arrow-whoosh.mp3",
  arrowHit: "/sounds/arrow-hit.mp3",
  dartHit: "/sounds/dart-hit.mp3",
  swish: "/sounds/swish.mp3",
  rim: "/sounds/rim.mp3",
  bounce: "/sounds/bounce.mp3",
  post: "/sounds/post.mp3",
  whistle: "/sounds/whistle.mp3",
  cheer: "/sounds/cheer.mp3",
  goalCheer: "/sounds/goal-cheer.mp3",
  aww: "/sounds/aww.mp3",
  whoosh: "/sounds/whoosh.mp3",
  kick: "/sounds/kick.wav",
  rain: "/sounds/Rain.mp3",
  thunder: "/sounds/Thunder.mp3",
};

let ctx = null;
let master = null;
const buffers = {};
let wind = null;
let rain = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  for (const [name, url] of Object.entries(FILES)) {
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => {
        buffers[name] = buf;
      })
      .catch(() => {
        // Offline before the first visit finished: that sound stays quiet.
      });
  }
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

export function setMuted(on) {
  muted = on;
  if (master) master.gain.setTargetAtTime(on ? 0 : 0.9, ctx.currentTime, 0.05);
}

const enabled = () => ctx && !muted && getSettings().sound;

export function play(name, { volume = 1, rate = 1, delay = 0 } = {}) {
  if (!enabled() || !buffers[name]) return;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  src.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(master);
  src.start(ctx.currentTime + delay);
}

// A short burst of white noise, the raw material for the synthesised ones.
function noiseBuffer(seconds) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// The bowstring: a low thrum that falls in pitch, and a slap of noise.
export function twang(strength = 1) {
  if (!enabled()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(70, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5 * strength, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.32);
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.08);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1800;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.35 * strength, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  n.connect(f).connect(ng).connect(master);
  n.start(t);
}

// The bow being drawn: a creak that rises while the pull is held.
export function creak() {
  if (!enabled()) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.5);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 8;
  f.frequency.setValueAtTime(400, t);
  f.frequency.linearRampToValueAtTime(900, t + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.15);
  g.gain.linearRampToValueAtTime(0.0001, t + 0.5);
  n.connect(f).connect(g).connect(master);
  n.start(t);
}

// One heartbeat: two low thumps, lub-dub, as the nerves chip's heart beats.
export function heartbeat(strength = 1) {
  if (!enabled() || !getSettings().heartbeat) return;
  const t = ctx.currentTime;
  for (const [at, vol] of [[0, 0.55], [0.17, 0.35]]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(62, t + at);
    osc.frequency.exponentialRampToValueAtTime(38, t + at + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.linearRampToValueAtTime(vol * strength, t + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.16);
    osc.connect(g).connect(master);
    osc.start(t + at);
    osc.stop(t + at + 0.18);
  }
}

// The wind, a loop of filtered noise, louder and brighter as it blows
// harder. `strength` 0 to 1.
export function setWind(strength) {
  if (!ctx) return;
  if (!wind) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(3);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    wind = { filter, gain };
  }
  const on = enabled() ? strength : 0;
  const t = ctx.currentTime;
  wind.gain.gain.setTargetAtTime(0.02 + 0.16 * on * on, t, 0.4);
  wind.filter.frequency.setTargetAtTime(250 + 900 * on, t, 0.4);
  if (!enabled()) wind.gain.gain.setTargetAtTime(0, t, 0.1);
}

export function buzz(pattern) {
  if (!getSettings().haptics || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Not allowed here.
  }
}

// The rain, looped, at `level` 0 (none) to 1 (a thunderstorm).
export function setRain(level) {
  if (!ctx) return;
  if (!rain) {
    if (!buffers.rain) return;
    const src = ctx.createBufferSource();
    src.buffer = buffers.rain;
    src.loop = true;
    // Past the fade at either end of the recording.
    src.loopStart = 0.6;
    src.loopEnd = Math.max(1, buffers.rain.duration - 0.6);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(master);
    src.start(0, 0.6);
    rain = { gain };
  }
  const on = enabled() ? level : 0;
  rain.gain.gain.setTargetAtTime(0.42 * on, ctx.currentTime, on ? 0.6 : 0.15);
}

// One thunderclap from a strike `km` away: closer is louder and sharper.
export function thunder(km) {
  if (!enabled() || !buffers.thunder) return;
  const src = ctx.createBufferSource();
  src.buffer = buffers.thunder;
  // Far ones a touch slower, which stretches the rumble out.
  src.playbackRate.value = Math.max(0.7, 1.05 - km * 0.025);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.max(220, 4000 / (1 + km * 0.9));
  const gain = ctx.createGain();
  gain.gain.value = Math.min(1, 1.6 / (1 + km * 0.35));
  src.connect(filter).connect(gain).connect(master);
  src.start();
}
