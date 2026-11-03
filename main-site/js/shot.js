// A saved picture of the replay, after stack-game's: the scene at 4K from
// js/scene.js's capture(), with a band across the bottom naming the
// player, the match and the site, then straight into the browser's
// downloads.
//
// The band is frosted glass in the game's own font and colours, light or
// dark with the theme: the scene behind it blurred and washed over, the
// player's name large in the brand colour, the result under it, the match
// (game, difficulty, length, weather, seed, day) under that, and the
// site's icon, name and address in the corner. Everything is sized from
// the picture's shorter side, so it reads the same on a wide 4K picture
// and a tall phone one, and a line too long for the width is set smaller
// rather than cut.
//
// The scene is framed round the band rather than under it: js/scene.js
// zooms out just enough that everything the player could see on screen
// fits above it.

const BRAND = "uwuShooty";
const ICON = "/UST-192.png";

let iconImage = null;
function loadIcon() {
  iconImage ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = ICON;
  });
  return iconImage;
}

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// Day, month, year, the month short: "3 Nov 2026", in the viewer's time.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function playedOn(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// The words, from what game.js passes:
//   name      the player's set name, or "" if none
//   title     what the match came to, "Won 21 to 18 against the bot"
//   score     the player's score, or null
//   game, difficulty, length, weather, seed, playedAt (ms, or null)
function lines(info) {
  const result = [info.title];
  if (info.score !== null && info.score !== undefined) result.push(`${info.score.toLocaleString("en")} points`);
  const detail = [info.game, info.difficulty, info.length];
  if (info.weather) detail.push(info.weather);
  detail.push(`Seed ${info.seed}`);
  if (info.playedAt) detail.push(playedOn(info.playedAt));
  return {
    title: info.name || info.title,
    result: (info.name ? result : result.slice(1)).join("  ·  ") || info.game,
    detail: detail.join("  ·  "),
  };
}

// Sets `font` at `size`, smaller if need be so `text` fits in `room`.
function fit(ctx, text, size, family, room) {
  ctx.font = `${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w <= room) return size;
  const smaller = Math.floor((size * room) / w);
  ctx.font = `${smaller}px ${family}`;
  return smaller;
}

// Fonts and the icon, ready before the picture is drawn: the band is laid
// out, and the scene framed round it, in the same moment as the draw,
// which cannot wait for either.
let icon = null;
export async function prepare() {
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  await document.fonts?.load(`50px ${family}`).catch(() => null);
  icon = await loadIcon();
}

// Where everything in the band goes on a W x H picture, and how tall the
// band is, which js/scene.js keeps clear of what the player could see.
export function layout(W, H, info) {
  const ctx = document.createElement("canvas").getContext("2d");
  const u = Math.min(W, H) / 1080;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  const sizes = { title: Math.round(50 * u), result: Math.round(31 * u), detail: Math.round(25 * u), brand: Math.round(40 * u) };
  const text = lines(info);
  const pad = Math.round(34 * u);
  const gap = Math.round(30 * u);
  const host = location.host || "shooty.uwuapps.org";

  // The corner: the icon, the name and the address. On a picture too
  // narrow for it beside the words, it drops to its own row under them.
  const iconSize = Math.round(76 * u);
  ctx.font = `${sizes.brand}px ${family}`;
  const brandW = ctx.measureText(BRAND).width;
  ctx.font = `${sizes.detail}px ${family}`;
  const hostW = ctx.measureText(host).width;
  const cornerW = (icon ? iconSize + Math.round(18 * u) : 0) + Math.max(brandW, hostW);
  ctx.font = `${sizes.title}px ${family}`;
  let wordsW = ctx.measureText(text.title).width;
  ctx.font = `${sizes.result}px ${family}`;
  wordsW = Math.max(wordsW, ctx.measureText(text.result).width);
  const beside = pad * 2 + wordsW + gap + cornerW <= W;
  const room = beside ? W - pad * 2 - gap - cornerW : W - pad * 2;

  const rows = [
    { text: text.title, size: fit(ctx, text.title, sizes.title, family, room), ink: "brand" },
    { text: text.result, size: fit(ctx, text.result, sizes.result, family, room), ink: "ink" },
    { text: text.detail, size: fit(ctx, text.detail, sizes.detail, family, room), ink: "muted" },
  ];
  const lead = 1.32;
  const wordsH = rows.reduce((h, r) => h + r.size * lead, 0) - rows[rows.length - 1].size * (lead - 1);
  const footH = beside ? 0 : Math.round(sizes.detail * 1.9);
  const bandH = Math.round(pad * 2 + Math.max(wordsH, beside ? iconSize : 0) + footH);
  return { W, H, u, family, sizes, pad, host, iconSize, brandW, hostW, beside, rows, lead, wordsH, bandH, top: H - bandH };
}

// Draws the band laid out by layout() onto the picture.
export function caption(canvas, plan) {
  const ctx = canvas.getContext("2d");
  const { W, u, family, sizes, pad, host, iconSize, brandW, hostW, beside, rows, lead, wordsH, bandH, top } = plan;
  const dark = document.documentElement.dataset.mode === "dark" || document.documentElement.classList.contains("dark");
  const inks = {
    ink: cssVar("--ink", dark ? "#eef2ef" : "#121815"),
    muted: cssVar("--muted", dark ? "#9aa7a0" : "#5b665f"),
    brand: cssVar("--brand-ink", cssVar("--brand", dark ? "#bff5cf" : "#1f6b3d")),
  };

  // Frosted: the scene behind, blurred, then washed over. A browser that
  // cannot blur a canvas still gets the wash.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, W, bandH);
  ctx.clip();
  if ("filter" in ctx) {
    const behind = document.createElement("canvas");
    behind.width = W;
    behind.height = bandH;
    behind.getContext("2d").drawImage(canvas, 0, top, W, bandH, 0, 0, W, bandH);
    ctx.filter = `blur(${Math.round(22 * u)}px)`;
    ctx.drawImage(behind, 0, top);
    ctx.filter = "none";
  }
  ctx.fillStyle = dark ? "rgba(12, 16, 14, 0.62)" : "rgba(255, 255, 255, 0.66)";
  ctx.fillRect(0, top, W, bandH);
  ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(0, top, W, Math.max(1, Math.round(2 * u)));
  ctx.restore();

  // The words, top to bottom, centred in the band beside the corner.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let y = top + pad + (beside ? Math.max(0, (iconSize - wordsH) / 2) : 0);
  for (const r of rows) {
    ctx.font = `${r.size}px ${family}`;
    ctx.fillStyle = inks[r.ink];
    ctx.fillText(r.text, pad, y + r.size * 0.88);
    y += r.size * lead;
  }

  if (beside) {
    const right = W - pad;
    const textX = right - Math.max(brandW, hostW);
    const mid = top + bandH / 2;
    if (icon) {
      const x = textX - Math.round(18 * u) - iconSize;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect?.(x, mid - iconSize / 2, iconSize, iconSize, Math.round(18 * u));
      ctx.clip();
      ctx.drawImage(icon, x, mid - iconSize / 2, iconSize, iconSize);
      ctx.restore();
    }
    ctx.textAlign = "right";
    ctx.font = `${sizes.brand}px ${family}`;
    ctx.fillStyle = inks.brand;
    ctx.fillText(BRAND, right, mid - Math.round(4 * u));
    ctx.font = `${sizes.detail}px ${family}`;
    ctx.fillStyle = inks.muted;
    ctx.fillText(host, right, mid + sizes.detail * 1.1);
  } else {
    // Its own row: a small icon, then "uwuShooty · the address".
    const rowY = plan.H - pad;
    const small = Math.round(sizes.detail * 1.3);
    let x = pad;
    if (icon) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect?.(x, rowY - small + sizes.detail * 0.2, small, small, Math.round(small * 0.24));
      ctx.clip();
      ctx.drawImage(icon, x, rowY - small + sizes.detail * 0.2, small, small);
      ctx.restore();
      x += small + Math.round(12 * u);
    }
    ctx.font = `${sizes.detail}px ${family}`;
    ctx.fillStyle = inks.brand;
    ctx.fillText(BRAND, x, rowY);
    x += ctx.measureText(`${BRAND}  `).width;
    ctx.fillStyle = inks.muted;
    ctx.fillText(`·  ${host}`, x, rowY);
  }
}

function fileName(game) {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return `uwushooty-${game.toLowerCase()}-${day}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.png`;
}

// Straight into the browser's downloads, on every device. Where it lands,
// and whether the browser asks first, is the browser's own setting.
export async function save(canvas, game = "match") {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not encode the picture");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(game);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
