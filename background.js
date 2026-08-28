import OBR from "https://esm.unpkg.com/@owlbear-rodeo/sdk@3.1.0";

const CONTROL_CHANNEL = "com.dso.soundtrack/control";
const STATE_CHANNEL = "com.dso.soundtrack/state";
const ENGINE_CHANNEL = "com.dso.soundtrack/engine";

const SYNC_INTERVAL_MS = 2000;
const HARD_DRIFT_SECONDS = 0.32;
const SOFT_DRIFT_SECONDS = 0.08;

const state = {
  roomId: "preview-room",
  role: "PLAYER",
  master: 0.70,
  tracks: {},
  audio: new Map(),
  ready: false,
  syncTimer: null,
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const now = () => Date.now();

function storageKey() {
  return `dso.soundtrack.engine.${state.roomId}`;
}

function normalizeDropboxUrl(input) {
  try {
    const url = new URL(input);
    if (/^(www\.)?dropbox\.com$/i.test(url.hostname)) {
      url.hostname = "dl.dropboxusercontent.com";
      url.searchParams.delete("dl");
      url.searchParams.delete("raw");
    }
    return url.toString();
  } catch {
    return input;
  }
}

function getPosition(track) {
  const base = Math.max(0, Number(track.position) || 0);
  if (track.status !== "playing" || !Number.isFinite(track.startedAt)) return base;

  const elapsed = Math.max(0, (now() - track.startedAt) / 1000);
  const raw = base + elapsed;
  if (track.loop && Number(track.duration) > 0) return raw % Number(track.duration);
  return raw;
}

function livePosition(track) {
  const audio = state.audio.get(track.id);
  if (audio && Number.isFinite(audio.currentTime) && audio.readyState >= 1) {
    return Math.max(0, audio.currentTime);
  }
  return getPosition(track);
}

function snapshot() {
  const sentAt = now();
  return {
    master: state.master,
    tracks: Object.values(state.tracks).map((track) => ({
      ...track,
      position: livePosition(track),
      startedAt: null,
    })),
    sentAt,
    updatedAt: sentAt,
  };
}

function persist() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(snapshot()));
  } catch {}
}

function loadPersisted() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
    if (!saved) return;
    if (Number.isFinite(saved.master)) state.master = clamp(saved.master, 0, 1);
    if (Array.isArray(saved.tracks)) {
      const stamp = now();
      state.tracks = Object.fromEntries(
        saved.tracks
          .filter((t) => t?.id && t?.url)
          .map((t) => [t.id, {
            ...t,
            position: Math.max(0, Number(t.position) || 0),
            startedAt: t.status === "playing" ? stamp : null,
          }])
      );
    }
  } catch {}
}

async function notifyLocal(data) {
  if (!OBR.isAvailable) return;
  try {
    await OBR.broadcast.sendMessage(ENGINE_CHANNEL, data, { destination: "LOCAL" });
  } catch {}
}

async function broadcastSnapshot(destination = "ALL") {
  if (!OBR.isAvailable) return;
  await OBR.broadcast.sendMessage(
    STATE_CHANNEL,
    { type: "snapshot", state: snapshot() },
    { destination }
  );
}

async function broadcastPatch(patch, destination = "ALL") {
  if (!OBR.isAvailable) return;
  await OBR.broadcast.sendMessage(
    STATE_CHANNEL,
    { type: "patch", patch, sentAt: now() },
    { destination }
  );
}

function effectiveVolume(track) {
  return clamp(state.master * clamp(Number(track.volume ?? 0.7), 0, 1), 0, 1);
}

function createAudio(track) {
  const audio = new Audio();
  const source = normalizeDropboxUrl(track.url);

  audio.preload = "auto";
  audio.src = source;
  audio.__dsoSource = source;
  audio.loop = !!track.loop;
  audio.volume = effectiveVolume(track);
  audio.playbackRate = 1;

  audio.addEventListener("loadedmetadata", async () => {
    if (!Number.isFinite(audio.duration)) return;
    const current = state.tracks[track.id];
    if (!current) return;

    if (Number.isFinite(audio.__dsoPendingPosition)) {
      try { audio.currentTime = Math.max(0, audio.__dsoPendingPosition); } catch {}
      audio.__dsoPendingPosition = null;
    }

    current.duration = audio.duration;
    persist();

    // Duration is metadata only: no player rebuild or seek.
    if (state.role === "GM" && OBR.isAvailable) {
      await broadcastPatch({
        kind: "duration",
        trackId: track.id,
        duration: audio.duration,
      }, "ALL");
    }
  });

  audio.addEventListener("ended", async () => {
    const current = state.tracks[track.id];
    if (!current || current.loop) return;

    delete state.tracks[track.id];
    audio.pause();
    state.audio.delete(track.id);
    persist();

    if (state.role === "GM" && OBR.isAvailable) {
      await broadcastSnapshot("ALL");
      await notifyLocal({ type: "state", state: snapshot(), role: state.role });
    }
  });

  audio.addEventListener("error", () => {
    notifyLocal({
      type: "audio-error",
      trackId: track.id,
      title: track.title,
      code: audio.error?.code || 0,
    });
  });

  state.audio.set(track.id, audio);
  return audio;
}

function ensureAudio(track) {
  let audio = state.audio.get(track.id);
  const desiredUrl = normalizeDropboxUrl(track.url);

  // Compare against our own source marker instead of HTMLAudioElement.src.
  // Browsers canonicalize `audio.src`, which previously caused false URL changes
  // and recreated the player when unrelated controls were moved.
  if (!audio || audio.__dsoSource !== desiredUrl) {
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      state.audio.delete(track.id);
    }
    audio = createAudio(track);
  }
  return audio;
}

function setAudioVolume(trackId) {
  const track = state.tracks[trackId];
  const audio = state.audio.get(trackId);
  if (!track || !audio) return;
  audio.volume = effectiveVolume(track);
}

function setAllAudioVolumes() {
  for (const track of Object.values(state.tracks)) setAudioVolume(track.id);
}

function setAudioLoop(trackId) {
  const track = state.tracks[trackId];
  const audio = state.audio.get(trackId);
  if (!track || !audio) return;
  audio.loop = !!track.loop;
}

function gentlyCorrectDrift(audio, desired) {
  if (!Number.isFinite(desired) || !Number.isFinite(audio.currentTime)) return;
  const drift = desired - audio.currentTime;
  const abs = Math.abs(drift);

  if (abs > HARD_DRIFT_SECONDS) {
    try { audio.currentTime = Math.max(0, desired); } catch {}
    audio.playbackRate = 1;
    return;
  }

  if (abs > SOFT_DRIFT_SECONDS && !audio.paused) {
    audio.playbackRate = drift > 0 ? 1.035 : 0.965;
    clearTimeout(audio.__dsoRateTimer);
    audio.__dsoRateTimer = setTimeout(() => {
      if (state.audio.get(audio.__dsoTrackId) === audio) audio.playbackRate = 1;
    }, 850);
  } else {
    audio.playbackRate = 1;
  }
}

async function applyTrackPlayback(track, { forcePosition = false } = {}) {
  const audio = ensureAudio(track);
  audio.__dsoTrackId = track.id;
  audio.loop = !!track.loop;
  audio.volume = effectiveVolume(track);

  const desired = getPosition(track);
  if (forcePosition) {
    try {
      audio.currentTime = Math.max(0, desired);
      audio.__dsoPendingPosition = null;
    } catch {
      audio.__dsoPendingPosition = Math.max(0, desired);
    }
  } else {
    gentlyCorrectDrift(audio, desired);
  }

  if (track.status === "playing") {
    if (audio.paused) {
      try {
        await audio.play();
        notifyLocal({ type: "audio-ready", trackId: track.id });
      } catch (error) {
        notifyLocal({
          type: "audio-blocked",
          trackId: track.id,
          message: String(error?.message || error),
        });
      }
    }
  } else {
    audio.pause();
    audio.playbackRate = 1;
  }
}

async function reconcilePlayback({ forceNew = false } = {}) {
  const alive = new Set(Object.keys(state.tracks));

  for (const [id, audio] of [...state.audio.entries()]) {
    if (!alive.has(id)) {
      audio.pause();
      audio.removeAttribute("src");
      state.audio.delete(id);
    }
  }

  for (const track of Object.values(state.tracks)) {
    const isNew = !state.audio.has(track.id);
    await applyTrackPlayback(track, { forcePosition: forceNew && isNew });
  }
}

async function hydrateRemoteSnapshot(incoming) {
  if (!incoming || typeof incoming !== "object") return;
  if (Number.isFinite(incoming.master)) state.master = clamp(incoming.master, 0, 1);

  const previous = state.tracks;
  if (Array.isArray(incoming.tracks)) {
    const receivedAt = now();
    state.tracks = Object.fromEntries(
      incoming.tracks
        .filter((t) => t?.id && t?.url)
        .map((t) => [t.id, {
          ...t,
          position: Math.max(0, Number(t.position) || 0),
          startedAt: t.status === "playing" ? receivedAt : null,
        }])
    );
  }

  const alive = new Set(Object.keys(state.tracks));
  for (const [id, audio] of [...state.audio.entries()]) {
    if (!alive.has(id)) {
      audio.pause();
      audio.removeAttribute("src");
      state.audio.delete(id);
    }
  }

  for (const track of Object.values(state.tracks)) {
    const prior = previous[track.id];
    const mustLockPosition = !prior || prior.status !== track.status;
    await applyTrackPlayback(track, { forcePosition: mustLockPosition });
  }

  persist();
  notifyLocal({ type: "state", state: snapshot(), role: state.role });
}

async function applyRemotePatch(patch) {
  if (!patch || typeof patch !== "object") return;

  if (patch.kind === "master") {
    state.master = clamp(Number(patch.value) || 0, 0, 1);
    setAllAudioVolumes();
  } else if (patch.kind === "track-volume") {
    const track = state.tracks[patch.trackId];
    if (!track) return;
    track.volume = clamp(Number(patch.value) || 0, 0, 1);
    setAudioVolume(track.id);
  } else if (patch.kind === "track-loop") {
    const track = state.tracks[patch.trackId];
    if (!track) return;
    track.loop = !!patch.value;
    setAudioLoop(track.id);
  } else if (patch.kind === "duration") {
    const track = state.tracks[patch.trackId];
    if (!track) return;
    track.duration = Math.max(0, Number(patch.duration) || 0);
  } else if (patch.kind === "playback") {
    const track = state.tracks[patch.trackId];
    if (!track) return;
    track.position = Math.max(0, Number(patch.position) || 0);
    track.status = patch.status === "playing" ? "playing" : "paused";
    track.startedAt = track.status === "playing" ? now() : null;
    await applyTrackPlayback(track, { forcePosition: true });
  } else {
    return;
  }

  persist();
  notifyLocal({ type: "patch", patch, role: state.role });
}

async function handleControl(data) {
  if (!data || typeof data !== "object") return;

  if (data.type === "request-state") {
    if (state.role === "GM") await broadcastSnapshot("ALL");
    return;
  }

  if (data.type === "ui-state-request") {
    await notifyLocal({ type: "state", state: snapshot(), role: state.role });
    return;
  }

  if (state.role !== "GM") return;

  // Mixer-only controls are patches. They NEVER rebuild, seek or replay audio.
  if (data.type === "set-master") {
    state.master = clamp(Number(data.value) || 0, 0, 1);
    setAllAudioVolumes();
    persist();
    await broadcastPatch({ kind: "master", value: state.master }, "ALL");
    return;
  }

  if (data.type === "set-track-volume") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    track.volume = clamp(Number(data.value) || 0, 0, 1);
    setAudioVolume(track.id);
    persist();
    await broadcastPatch({ kind: "track-volume", trackId: track.id, value: track.volume }, "ALL");
    return;
  }

  if (data.type === "set-track-loop") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    track.loop = !!data.value;
    setAudioLoop(track.id);
    persist();
    await broadcastPatch({ kind: "track-loop", trackId: track.id, value: track.loop }, "ALL");
    return;
  }

  if (data.type === "play-track") {
    const incoming = data.track;
    if (!incoming?.id || !incoming?.url) return;

    const existing = state.tracks[incoming.id] || {};
    const position = Math.max(0, Number(data.position ?? 0) || 0);
    state.tracks[incoming.id] = {
      ...existing,
      ...incoming,
      volume: clamp(Number(incoming.volume ?? existing.volume ?? 0.7), 0, 1),
      loop: incoming.loop ?? existing.loop ?? true,
      status: "playing",
      position,
      startedAt: now(),
      duration: Math.max(0, Number(existing.duration || incoming.duration || 0) || 0),
    };

    const audio = ensureAudio(state.tracks[incoming.id]);
    try {
      audio.currentTime = position;
      audio.__dsoPendingPosition = null;
    } catch {
      audio.__dsoPendingPosition = position;
    }
    await applyTrackPlayback(state.tracks[incoming.id], { forcePosition: true });
  } else if (data.type === "pause-track") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    const audio = state.audio.get(track.id);
    track.position = audio && Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : getPosition(track);
    track.status = "paused";
    track.startedAt = null;
    if (audio) {
      audio.pause();
      audio.playbackRate = 1;
    }
    await broadcastPatch({ kind: "playback", trackId: track.id, status: "paused", position: track.position }, "ALL");
  } else if (data.type === "resume-track") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    const audio = ensureAudio(track);
    if (Number.isFinite(audio.currentTime)) track.position = Math.max(0, audio.currentTime);
    track.status = "playing";
    track.startedAt = now();
    await applyTrackPlayback(track, { forcePosition: false });
    await broadcastPatch({ kind: "playback", trackId: track.id, status: "playing", position: track.position }, "ALL");
  } else if (data.type === "stop-track") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    delete state.tracks[data.trackId];
    const audio = state.audio.get(data.trackId);
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      state.audio.delete(data.trackId);
    }
  } else if (data.type === "stop-all") {
    state.tracks = {};
    for (const audio of state.audio.values()) {
      audio.pause();
      audio.removeAttribute("src");
    }
    state.audio.clear();
  } else if (data.type === "seek-track") {
    const track = state.tracks[data.trackId];
    if (!track) return;
    track.position = Math.max(0, Number(data.position) || 0);
    track.startedAt = track.status === "playing" ? now() : null;
    const audio = ensureAudio(track);
    try {
      audio.currentTime = track.position;
      audio.__dsoPendingPosition = null;
    } catch {
      audio.__dsoPendingPosition = track.position;
    }
    await broadcastPatch({ kind: "playback", trackId: track.id, status: track.status, position: track.position }, "ALL");
  } else if (data.type === "update-track") {
    const incoming = data.track;
    const track = state.tracks[incoming?.id];
    if (!track) return;

    const position = getPosition(track);
    const previousUrl = normalizeDropboxUrl(track.url);
    const nextUrl = normalizeDropboxUrl(incoming.url ?? track.url);

    Object.assign(track, incoming, {
      position,
      startedAt: track.status === "playing" ? now() : null,
    });

    if (previousUrl !== nextUrl) {
      const oldAudio = state.audio.get(track.id);
      if (oldAudio) {
        oldAudio.pause();
        oldAudio.removeAttribute("src");
        state.audio.delete(track.id);
      }
      await applyTrackPlayback(track, { forcePosition: true });
    } else {
      setAudioVolume(track.id);
      setAudioLoop(track.id);
    }
  } else {
    return;
  }

  persist();
  await reconcilePlayback();
  await broadcastSnapshot("ALL");
  await notifyLocal({ type: "state", state: snapshot(), role: state.role });
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
    await reconcilePlayback({ forceNew: true });

    OBR.broadcast.onMessage(CONTROL_CHANNEL, (event) => handleControl(event.data));
    OBR.broadcast.onMessage(STATE_CHANNEL, (event) => {
      const data = event.data;
      if (!data || state.role === "GM") return;
      if (data.type === "snapshot") hydrateRemoteSnapshot(data.state);
      if (data.type === "patch") applyRemotePatch(data.patch).catch(() => {});
    });

    state.ready = true;
    await notifyLocal({ type: "state", state: snapshot(), role: state.role });

    if (state.role !== "GM") {
      await OBR.broadcast.sendMessage(
        CONTROL_CHANNEL,
        { type: "request-state" },
        { destination: "REMOTE" }
      );
    } else {
      await broadcastSnapshot("REMOTE");
      state.syncTimer = setInterval(() => {
        broadcastSnapshot("REMOTE").catch(() => {});
      }, SYNC_INTERVAL_MS);
    }
  });
}

init();
