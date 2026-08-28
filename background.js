import OBR from "https://esm.unpkg.com/@owlbear-rodeo/sdk@3.1.0";

const CONTROL_CHANNEL = "com.dso.soundtrack/control";
const STATE_CHANNEL = "com.dso.soundtrack/state";
const ENGINE_CHANNEL = "com.dso.soundtrack/engine";

const state = {
  roomId: "preview-room",
  role: "PLAYER",
  master: 0.70,
  tracks: {},
  audio: new Map(),
  ready: false,
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const now = () => Date.now();

function storageKey() {
  return `dso.soundtrack.engine.${state.roomId}`;
}

function serializableState() {
  const stamp = now();
  return {
    master: state.master,
    tracks: Object.values(state.tracks).map((track) => ({
      ...track,
      position: getPosition(track),
      startedAt: track.status === "playing" ? stamp : null,
    })),
    updatedAt: stamp,
  };
}

function persist() {
  try { localStorage.setItem(storageKey(), JSON.stringify(serializableState())); } catch {}
}

function loadPersisted() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
    if (!saved) return;
    if (Number.isFinite(saved.master)) state.master = clamp(saved.master, 0, 1);
    if (Array.isArray(saved.tracks)) {
      state.tracks = Object.fromEntries(saved.tracks.filter(t => t?.id && t?.url).map(t => [t.id, t]));
    }
  } catch {}
}

function normalizeDropboxUrl(input) {
  try {
    const url = new URL(input);
    if (/dropbox\.com$/i.test(url.hostname) || /www\.dropbox\.com$/i.test(url.hostname)) {
      url.hostname = "dl.dropboxusercontent.com";
      url.searchParams.delete("dl");
      url.searchParams.delete("raw");
      return url.toString();
    }
    return url.toString();
  } catch {
    return input;
  }
}

function getPosition(track) {
  if (track.status === "playing" && Number.isFinite(track.startedAt)) {
    const elapsed = Math.max(0, (now() - track.startedAt) / 1000);
    if (track.loop && track.duration > 0) return elapsed % track.duration;
    return Math.max(0, track.position + elapsed);
  }
  return Math.max(0, Number(track.position) || 0);
}

function createAudio(track) {
  const audio = new Audio();
  audio.preload = "auto";
  audio.src = normalizeDropboxUrl(track.url);
  audio.loop = !!track.loop;
  audio.volume = clamp(state.master * clamp(track.volume ?? 0.7, 0, 1), 0, 1);
  audio.addEventListener("loadedmetadata", async () => {
    if (!Number.isFinite(audio.duration)) return;
    const current = state.tracks[track.id];
    if (!current) return;
    current.duration = audio.duration;
    persist();
    if (state.role === "GM" && OBR.isAvailable) {
      await OBR.broadcast.sendMessage(STATE_CHANNEL, { type: "state", state: serializableState() }, { destination: "ALL" });
    }
  });
  audio.addEventListener("ended", async () => {
    const current = state.tracks[track.id];
    if (!current || current.loop) return;
    current.status = "stopped";
    current.position = 0;
    current.startedAt = null;
    persist();
    if (state.role === "GM" && OBR.isAvailable) {
      await OBR.broadcast.sendMessage(STATE_CHANNEL, { type: "state", state: serializableState() }, { destination: "ALL" });
    }
  });
  audio.addEventListener("error", () => {
    notifyLocal({ type: "audio-error", trackId: track.id, title: track.title, code: audio.error?.code || 0 });
  });
  state.audio.set(track.id, audio);
  return audio;
}

function ensureAudio(track) {
  let audio = state.audio.get(track.id);
  const desiredUrl = normalizeDropboxUrl(track.url);
  if (!audio || audio.src !== desiredUrl) {
    if (audio) { audio.pause(); state.audio.delete(track.id); }
    audio = createAudio(track);
  }
  return audio;
}

async function applyTrack(track) {
  const audio = ensureAudio(track);
  audio.loop = !!track.loop;
  audio.volume = clamp(state.master * clamp(track.volume ?? 0.7, 0, 1), 0, 1);
  const desired = getPosition(track);
  if (Number.isFinite(desired) && Math.abs((audio.currentTime || 0) - desired) > 1.25) {
    try { audio.currentTime = desired; } catch {}
  }
  if (track.status === "playing") {
    try {
      await audio.play();
      notifyLocal({ type: "audio-ready", trackId: track.id });
    } catch (error) {
      notifyLocal({ type: "audio-blocked", trackId: track.id, message: String(error?.message || error) });
    }
  } else {
    audio.pause();
  }
}

async function applyAll() {
  const alive = new Set(Object.keys(state.tracks));
  for (const [id, audio] of state.audio.entries()) {
    if (!alive.has(id)) {
      audio.pause();
      audio.removeAttribute("src");
      state.audio.delete(id);
    }
  }
  for (const track of Object.values(state.tracks)) await applyTrack(track);
}

async function notifyLocal(data) {
  if (!OBR.isAvailable) return;
  try { await OBR.broadcast.sendMessage(ENGINE_CHANNEL, data, { destination: "LOCAL" }); } catch {}
}

async function broadcastState(destination = "ALL") {
  if (!OBR.isAvailable) return;
  await OBR.broadcast.sendMessage(STATE_CHANNEL, { type: "state", state: serializableState() }, { destination });
}

async function handleControl(data) {
  if (!data || typeof data !== "object") return;
  if (data.type === "request-state") {
    if (state.role === "GM") await broadcastState("ALL");
    return;
  }
  if (data.type === "ui-state-request") {
    await notifyLocal({ type: "state", state: serializableState(), role: state.role });
    return;
  }
  if (state.role !== "GM") return;

  if (data.type === "set-master") {
    state.master = clamp(Number(data.value) || 0, 0, 1);
  } else if (data.type === "play-track") {
    const incoming = data.track;
    if (!incoming?.id || !incoming?.url) return;
    const existing = state.tracks[incoming.id] || {};
    const position = Number(data.position ?? existing.position ?? 0) || 0;
    state.tracks[incoming.id] = {
      ...existing,
      ...incoming,
      volume: clamp(Number(incoming.volume ?? existing.volume ?? 0.7), 0, 1),
      loop: incoming.loop ?? existing.loop ?? true,
      status: "playing",
      position,
      startedAt: now(),
      duration: Number(existing.duration || incoming.duration || 0) || 0,
    };
  } else if (data.type === "pause-track") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    track.position = getPosition(track);
    track.status = "paused";
    track.startedAt = null;
  } else if (data.type === "resume-track") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    track.status = "playing";
    track.startedAt = now();
  } else if (data.type === "stop-track") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    delete state.tracks[data.trackId];
  } else if (data.type === "stop-all") {
    state.tracks = {};
  } else if (data.type === "set-track-volume") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    track.volume = clamp(Number(data.value) || 0, 0, 1);
  } else if (data.type === "set-track-loop") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    track.loop = !!data.value;
  } else if (data.type === "seek-track") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    track.position = Math.max(0, Number(data.position) || 0);
    track.startedAt = track.status === "playing" ? now() : null;
  } else if (data.type === "update-track") {
    const track = state.tracks[data.track?.id];
    if (!track) return;
    const position = getPosition(track);
    Object.assign(track, data.track, { position, startedAt: track.status === "playing" ? now() : null });
  } else {
    return;
  }

  persist();
  await applyAll();
  await broadcastState("ALL");
  await notifyLocal({ type: "state", state: serializableState(), role: state.role });
}

function hydrateRemote(incoming) {
  if (!incoming || typeof incoming !== "object") return;
  if (Number.isFinite(incoming.master)) state.master = clamp(incoming.master, 0, 1);
  if (Array.isArray(incoming.tracks)) {
    const localStamp = now();
    state.tracks = Object.fromEntries(incoming.tracks.filter(t => t?.id && t?.url).map(t => [t.id, {
      ...t,
      startedAt: t.status === "playing" ? localStamp : null,
    }]));
  }
  persist();
  applyAll();
  notifyLocal({ type: "state", state: serializableState(), role: state.role });
}

async function init() {
  if (!OBR.isAvailable) {
    loadPersisted();
    state.ready = true;
    return;
  }
  OBR.onReady(async () => {
    state.roomId = OBR.room.id || "room";
    state.role = await OBR.player.getRole();
    loadPersisted();
    await applyAll();

    OBR.broadcast.onMessage(CONTROL_CHANNEL, (event) => handleControl(event.data));
    OBR.broadcast.onMessage(STATE_CHANNEL, (event) => {
      const data = event.data;
      if (data?.type !== "state") return;
      if (state.role === "GM") return;
      hydrateRemote(data.state);
    });

    state.ready = true;
    await notifyLocal({ type: "state", state: serializableState(), role: state.role });
    if (state.role !== "GM") {
      await OBR.broadcast.sendMessage(CONTROL_CHANNEL, { type: "request-state" }, { destination: "REMOTE" });
    } else {
      await broadcastState("REMOTE");
    }
  });
}

init();
