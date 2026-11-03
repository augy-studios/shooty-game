#!/usr/bin/env node
// docs/STUN-p2p-spec.md, rule 1: every peer is made with this app's own ICE list,
// which has no TURN relay in it. Fails on a turn: or turns: URL anywhere in
// the app's own code, and on a `new Peer(` that does not pass PEER_OPTIONS.
//
// PeerJS itself loads from cdnjs only when somebody hosts or joins, and is
// not in this repo; its built-in default config names PeerJS's public TURN
// servers, and passing our own config is what replaces it.
//
// Run: node scripts/check-p2p.mjs

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const JS = join(dirname(fileURLToPath(import.meta.url)), "..", "main-site", "js");
const failures = [];

for (const file of readdirSync(JS).filter((f) => f.endsWith(".js"))) {
  const code = readFileSync(join(JS, file), "utf8");
  // A TURN URL in a string, such as "turn:host:3478".
  if (/["'`]turns?:[a-z0-9[]/i.test(code)) failures.push(`${file}: names a turn: or turns: server`);
  for (const call of code.matchAll(/new Peer\(([^)]*)\)/g)) {
    if (!call[1].includes("PEER_OPTIONS")) failures.push(`${file}: new Peer(${call[1]}) without PEER_OPTIONS`);
  }
}

const p2p = readFileSync(join(JS, "net.js"), "utf8");
if (!/config:\s*\{\s*iceServers:\s*ICE_SERVERS\s*\}/.test(p2p)) failures.push("net.js: PEER_OPTIONS does not set config.iceServers");

if (failures.length) {
  console.error("p2p check failed:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("p2p ok: STUN only, every peer passes PEER_OPTIONS.");
