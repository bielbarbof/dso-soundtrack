import OBR from "https://esm.unpkg.com/@owlbear-rodeo/sdk@3.1.0";

const CONTROL_CHANNEL = "com.dso.soundtrack/control";
const STATE_CHANNEL = "com.dso.soundtrack/state";
const ENGINE_CHANNEL = "com.dso.soundtrack/engine";

const state = {
  roomId: "preview-room",
  playerId: "preview-user",
  role: "GM",
  library: [],
  master: 0.70,
  tracks: [],
  filter: "",
  tag: "TODAS",
  engineReady: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const els = {
  role: $("#roleLabel"), master: $("#masterSlider"), masterValue: $("#masterValue"),
  activeCount: $("#activeCount"), syncState: $("#syncState"), now: $("#nowPlaying"), empty: $("#emptyMix"),
  library: $("#libraryList"), libraryCount: $("#libraryCount"), search: $("#searchInput"), tags: $("#tagFilters"),
  menu: $("#menu"), dialog: $("#trackDialog"), form: $("#trackForm"), csv: $("#csvInput"), toast: $("#toast"), loading: $("#loading"),
  playerNotice: $("#playerNotice"), stopAll: $("#stopAllButton"),
};

function esc(value) {
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function normalizeDropboxUrl(input) {
  try {
    const url = new URL(input.trim());
    if (/^(www\.)?dropbox\.com$/i.test(url.hostname)) {
      url.hostname = "dl.dropboxusercontent.com";
      url.searchParams.delete("dl");
      url.searchParams.delete("raw");
    }
    return url.toString();
  } catch { return input.trim(); }
}
function libraryKey() { return `dso.soundtrack.library.${state.roomId}.${state.playerId}`; }
function loadLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem(libraryKey()) || "[]");
    state.library = Array.isArray(saved) ? saved.filter(x => x?.id && x?.url) : [];
  } catch { state.library = []; }
}
function saveLibrary() { try { localStorage.setItem(libraryKey(), JSON.stringify(state.library)); } catch {} }
function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(seconds / 60); const s = seconds % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function currentPosition(track) {
  if (track.status === "playing" && Number.isFinite(track.startedAt)) {
    const elapsed = Math.max(0, (Date.now() - track.startedAt) / 1000);
    if (track.loop && track.duration > 0) return elapsed % track.duration;
    return Math.max(0, (track.position || 0) + elapsed);
  }
  return Math.max(0, Number(track.position) || 0);
}
function playingTrack(id) { return state.tracks.find(t => t.id === id); }
function showToast(text, ms=2400) {
  els.toast.textContent = text; els.toast.classList.remove("hidden");
  clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>els.toast.classList.add("hidden"),ms);
}
function updateRangeFill(input, color="#bb2029") {
  const min=Number(input.min)||0, max=Number(input.max)||100, value=Number(input.value)||0;
  const pct=((value-min)/(max-min))*100;
  input.style.background=`linear-gradient(90deg,${color} 0 ${pct}%,#303540 ${pct}% 100%)`;
}

async function sendControl(data) {
  if (state.role !== "GM") return;
  if (!OBR.isAvailable) {
    previewHandle(data); return;
  }
  await OBR.broadcast.sendMessage(CONTROL_CHANNEL, data, { destination: "LOCAL" });
}

function previewHandle(data) {
  let shouldRender=true;
  if (data.type === "set-master") { state.master=data.value; shouldRender=false; }
  if (data.type === "play-track") {
    const old=playingTrack(data.track.id); const track={...old,...data.track,status:"playing",position:data.position||0,startedAt:Date.now(),duration:old?.duration||0};
    state.tracks=state.tracks.filter(t=>t.id!==track.id).concat(track);
  }
  if (data.type === "pause-track") { const t=playingTrack(data.trackId); if(t){t.position=currentPosition(t);t.status="paused";t.startedAt=null;} }
  if (data.type === "resume-track") { const t=playingTrack(data.trackId); if(t){t.status="playing";t.startedAt=Date.now();} }
  if (data.type === "stop-track") state.tracks=state.tracks.filter(t=>t.id!==data.trackId);
  if (data.type === "stop-all") state.tracks=[];
  if (data.type === "set-track-volume") { const t=playingTrack(data.trackId); if(t)t.volume=data.value; shouldRender=false; }
  if (data.type === "set-track-loop") { const t=playingTrack(data.trackId); if(t)t.loop=data.value; shouldRender=false; }
  if (data.type === "seek-track") { const t=playingTrack(data.trackId); if(t){t.position=data.position;t.startedAt=t.status==="playing"?Date.now():null;} }
  if (data.type === "update-track") { const t=playingTrack(data.track?.id); if(t)Object.assign(t,data.track); }
  if (shouldRender) renderAll();
}

function setEngineState(payload) {
  if (!payload) return;
  if (Number.isFinite(payload.master)) state.master=clamp(payload.master,0,1);
  if (Array.isArray(payload.tracks)) {
    const stamp=Date.now();
    state.tracks=payload.tracks.map(t=>({ ...t, startedAt:t.status==="playing"?stamp:null }));
  }
  state.engineReady=true;
  renderAll();
}

function applyEnginePatch(patch) {
  if (!patch || typeof patch !== "object") return;

  if (patch.kind === "master") {
    state.master=clamp(Number(patch.value)||0,0,1);
    const pct=Math.round(state.master*100);
    if (!els.master.matches(":active")) els.master.value=pct;
    els.masterValue.textContent=`${pct}%`;
    updateRangeFill(els.master);
    return;
  }

  const track=playingTrack(patch.trackId);
  if (!track) return;
  const card=els.now.querySelector(`[data-track-id="${CSS.escape(String(track.id))}"]`);

  if (patch.kind === "track-volume") {
    track.volume=clamp(Number(patch.value)||0,0,1);
    if (card) {
      const slider=card.querySelector(".track-volume");
      const out=card.querySelector(".volume-wrap output");
      const pct=Math.round(track.volume*100);
      if (slider && !slider.matches(":active")) slider.value=pct;
      if (slider) updateRangeFill(slider,"#d7d9de");
      if (out) out.textContent=`${pct}%`;
    }
  } else if (patch.kind === "track-loop") {
    track.loop=!!patch.value;
    if (card) {
      const btn=card.querySelector('[data-action="loop"]');
      if (btn) {
        btn.classList.toggle("active",track.loop);
        btn.textContent=`LOOP ${track.loop?"ON":"OFF"}`;
      }
    }
  } else if (patch.kind === "duration") {
    track.duration=Math.max(0,Number(patch.duration)||0);
    if (card) {
      const times=card.querySelectorAll(".timeline time");
      if (times[1]) times[1].textContent=track.duration?formatTime(track.duration):"--:--";
      const seek=card.querySelector(".track-seek");
      if (seek) seek.max=Math.max(track.duration,currentPosition(track),1);
    }
  }
}

function renderMaster() {
  const pct=Math.round(state.master*100);
  els.master.value=pct; els.masterValue.textContent=`${pct}%`; updateRangeFill(els.master);
  const count=state.tracks.length;
  els.activeCount.textContent=`${String(count).padStart(2,"0")} FAIXA${count===1?"":"S"} ATIVA${count===1?"":"S"}`;
  els.syncState.textContent=state.engineReady?"SYNC // ONLINE":"SYNC // AGUARDANDO";
}

function icon(type) {
  const paths={
    play:'<path class="play-icon" d="M8 5v14l11-7z"/>',
    pause:'<path d="M9 6v12M15 6v12"/>',
    stop:'<rect x="7" y="7" width="10" height="10" rx="1"/>',
    edit:'<path d="m5 19 3.7-.8L18 8.9 15.1 6 5.8 15.3 5 19ZM13.8 7.3l2.9 2.9"/>',
    trash:'<path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 10v7m4-7v7"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[type]}</svg>`;
}

function renderNow() {
  els.empty.classList.toggle("hidden",state.tracks.length>0);
  els.now.innerHTML=state.tracks.map(track=>{
    const pos=currentPosition(track); const duration=Number(track.duration)||0; const max=Math.max(duration,pos,1);
    const tags=(track.tags||[]).join(" // ") || "TRILHA";
    const isPlaying=track.status==="playing";
    return `<article class="mix-card ${isPlaying?"is-playing":""}" data-track-id="${esc(track.id)}">
      <div class="mix-head"><div class="track-title"><strong>${esc(track.title)}</strong><small>${esc(tags)}${isPlaying?" // PLAY":" // PAUSA"}</small></div>
        <div class="track-actions gm-only">
          <button data-action="${isPlaying?"pause":"resume"}" title="${isPlaying?"Pausar":"Continuar"}">${icon(isPlaying?"pause":"play")}</button>
          <button data-action="stop" class="danger" title="Parar">${icon("stop")}</button>
        </div>
      </div>
      <div class="timeline"><time data-pos>${formatTime(pos)}</time><input class="range track-seek" type="range" min="0" max="${max}" step="0.1" value="${Math.min(pos,max)}" ${state.role!=="GM"?"disabled":""}/><time>${duration?formatTime(duration):"--:--"}</time></div>
      <div class="mix-controls"><div class="volume-wrap"><span>VOL</span><input class="range track-volume" type="range" min="0" max="100" value="${Math.round((track.volume??.7)*100)}" ${state.role!=="GM"?"disabled":""}/><output>${Math.round((track.volume??.7)*100)}%</output></div>
      <button class="loop-button ${track.loop?"active":""} gm-only" data-action="loop" title="Repetir esta faixa continuamente">LOOP ${track.loop?"ON":"OFF"}</button></div>
    </article>`;
  }).join("");

  $$(".mix-card").forEach(card=>{
    const id=card.dataset.trackId; const track=playingTrack(id); if(!track)return;
    const vol=card.querySelector(".track-volume"), seek=card.querySelector(".track-seek");
    if(vol) updateRangeFill(vol,"#d7d9de"); if(seek) updateRangeFill(seek,"#bb2029");
  });
  applyRoleVisibility();
}

function visibleLibrary() {
  const q=state.filter.trim().toLowerCase();
  return state.library.filter(track=>{
    const tagOk=state.tag==="TODAS" || (track.tags||[]).some(t=>t.toUpperCase()===state.tag);
    const text=`${track.title} ${(track.tags||[]).join(" ")}`.toLowerCase();
    return tagOk && (!q || text.includes(q));
  });
}
function allTags() {
  return [...new Set(state.library.flatMap(t=>t.tags||[]).map(t=>t.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
}
function renderTags() {
  const tags=allTags();
  if(state.tag!=="TODAS" && !tags.some(t=>t.toUpperCase()===state.tag)) state.tag="TODAS";
  els.tags.innerHTML=["TODAS",...tags].map(tag=>`<button class="tag-filter ${state.tag===tag.toUpperCase()?"active":""}" data-tag="${esc(tag.toUpperCase())}">${esc(tag)}</button>`).join("");
}
function renderLibrary() {
  if(els.libraryCount) els.libraryCount.textContent=String(state.library.length).padStart(2,"0"); renderTags();
  const list=visibleLibrary();
  if(!list.length){ els.library.innerHTML='<div class="empty-state"><span class="empty-mark">◇</span><strong>NENHUMA FAIXA ENCONTRADA</strong><small>Adicione uma trilha ou altere os filtros.</small></div>'; return; }
  els.library.innerHTML=list.map(track=>{
    const active=!!playingTrack(track.id);
    return `<article class="library-card" data-library-id="${esc(track.id)}"><div class="library-info"><strong>${esc(track.title)}</strong><div class="library-tags">${(track.tags||[]).slice(0,4).map(t=>`<span>${esc(t)}</span>`).join("")}</div></div><div class="library-actions">
      <button data-action="play" title="${active?"Reiniciar em camada":"Tocar em camada"}">${icon("play")}</button>
      <button data-action="edit" title="Editar">${icon("edit")}</button>
      <button data-action="delete" title="Excluir">${icon("trash")}</button>
    </div></article>`;
  }).join("");
}
function renderAll(){ renderMaster(); renderNow(); if(state.role==="GM")renderLibrary(); applyRoleVisibility(); }
function applyRoleVisibility(){
  const gm=state.role==="GM"; $$(".gm-only").forEach(el=>el.classList.toggle("hidden",!gm));
  els.playerNotice.classList.toggle("hidden",gm); els.stopAll.classList.toggle("hidden",!gm);
  els.master.disabled=!gm; els.role.textContent=gm?"Mestre // Controle global":"Jogador // Sincronizado ao Mestre";
}

function openTrackDialog(track=null){
  $("#trackDialogTitle").textContent=track?"EDITAR FAIXA":"ADICIONAR FAIXA"; $("#trackId").value=track?.id||""; $("#trackTitle").value=track?.title||""; $("#trackUrl").value=track?.url||""; $("#trackTags").value=(track?.tags||[]).join(", "); $("#trackVolume").value=Math.round((track?.volume??.7)*100); $("#trackLoop").checked=track?.loop??true; els.dialog.showModal(); setTimeout(()=>$("#trackTitle").focus(),30);
}
function closeTrackDialog(){ els.dialog.close(); els.form.reset(); }

function parseCSV(text){
  const rows=[]; let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1]; if(ch==='"'){if(quoted&&next==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell="";}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(cell);cell="";if(row.some(x=>x.trim()!==""))rows.push(row);row=[];}else cell+=ch;}
  row.push(cell);if(row.some(x=>x.trim()!==""))rows.push(row); return rows;
}
function csvEscape(v){const s=String(v??"");return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
function exportCSV(){
  const lines=[["title","url","tags","volume","loop"],...state.library.map(t=>[t.title,t.url,(t.tags||[]).join("|"),Math.round((t.volume??.7)*100),t.loop?"true":"false"])].map(r=>r.map(csvEscape).join(","));
  const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="dso-soundtrack.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

els.master.addEventListener("input",()=>{state.master=Number(els.master.value)/100;renderMaster();sendControl({type:"set-master",value:state.master});});
els.stopAll.addEventListener("click",()=>sendControl({type:"stop-all"}));
$("#menuButton").addEventListener("click",()=>els.menu.classList.toggle("hidden"));
document.addEventListener("click",e=>{if(!els.menu.contains(e.target)&&!$("#menuButton").contains(e.target))els.menu.classList.add("hidden");});
$("#addTrackButton").addEventListener("click",()=>{els.menu.classList.add("hidden");openTrackDialog();});
$("#addTrackQuick").addEventListener("click",()=>openTrackDialog());
$("#closeDialog").addEventListener("click",closeTrackDialog); $("#cancelDialog").addEventListener("click",closeTrackDialog);
els.form.addEventListener("submit",e=>{e.preventDefault();const id=$("#trackId").value||makeId();const track={id,title:$("#trackTitle").value.trim(),url:normalizeDropboxUrl($("#trackUrl").value),tags:$("#trackTags").value.split(",").map(x=>x.trim()).filter(Boolean),volume:clamp(Number($("#trackVolume").value)/100,0,1),loop:$("#trackLoop").checked};if(!track.title||!track.url)return;const idx=state.library.findIndex(t=>t.id===id);if(idx>=0)state.library[idx]=track;else state.library.push(track);saveLibrary();renderLibrary();const active=playingTrack(id);if(active)sendControl({type:"update-track",track});closeTrackDialog();showToast(idx>=0?"Faixa atualizada.":"Faixa adicionada à biblioteca.");});
els.search.addEventListener("input",()=>{state.filter=els.search.value;renderLibrary();});
els.tags.addEventListener("click",e=>{const btn=e.target.closest("[data-tag]");if(!btn)return;state.tag=btn.dataset.tag;renderLibrary();});
els.library.addEventListener("click",e=>{const card=e.target.closest(".library-card"),btn=e.target.closest("button[data-action]");if(!card||!btn)return;const track=state.library.find(t=>t.id===card.dataset.libraryId);if(!track)return;if(btn.dataset.action==="play")sendControl({type:"play-track",track,position:0});if(btn.dataset.action==="edit")openTrackDialog(track);if(btn.dataset.action==="delete"){state.library=state.library.filter(t=>t.id!==track.id);saveLibrary();renderLibrary();showToast("Faixa removida da biblioteca.");}});
els.now.addEventListener("click",e=>{const card=e.target.closest(".mix-card"),btn=e.target.closest("button[data-action]");if(!card||!btn)return;const id=card.dataset.trackId,track=playingTrack(id);if(!track)return;const a=btn.dataset.action;if(a==="pause")sendControl({type:"pause-track",trackId:id});if(a==="resume")sendControl({type:"resume-track",trackId:id});if(a==="stop")sendControl({type:"stop-track",trackId:id});if(a==="loop")sendControl({type:"set-track-loop",trackId:id,value:!track.loop});});
els.now.addEventListener("input",e=>{const card=e.target.closest(".mix-card");if(!card)return;const id=card.dataset.trackId;if(e.target.classList.contains("track-volume")){const out=e.target.parentElement.querySelector("output");out.textContent=`${e.target.value}%`;updateRangeFill(e.target,"#d7d9de");sendControl({type:"set-track-volume",trackId:id,value:Number(e.target.value)/100});}if(e.target.classList.contains("track-seek")){updateRangeFill(e.target,"#bb2029");card.querySelector("[data-pos]").textContent=formatTime(e.target.value);}});
els.now.addEventListener("change",e=>{const card=e.target.closest(".mix-card");if(card&&e.target.classList.contains("track-seek"))sendControl({type:"seek-track",trackId:card.dataset.trackId,position:Number(e.target.value)});});
$("#importButton").addEventListener("click",()=>{els.menu.classList.add("hidden");els.csv.click();});
els.csv.addEventListener("change",async()=>{const file=els.csv.files?.[0];if(!file)return;const rows=parseCSV(await file.text());const header=(rows.shift()||[]).map(x=>x.trim().toLowerCase());let added=0;for(const row of rows){const obj=Object.fromEntries(header.map((h,i)=>[h,row[i]??""]));if(!obj.title||!obj.url)continue;state.library.push({id:makeId(),title:obj.title.trim(),url:normalizeDropboxUrl(obj.url),tags:String(obj.tags||"").split("|").map(x=>x.trim()).filter(Boolean),volume:clamp(Number(obj.volume||70)/100,0,1),loop:String(obj.loop||"true").toLowerCase()!=="false"});added++;}saveLibrary();renderLibrary();els.csv.value="";showToast(`${added} faixa${added===1?"":"s"} importada${added===1?"":"s"}.`);});
$("#exportButton").addEventListener("click",()=>{els.menu.classList.add("hidden");exportCSV();});
$("#clearLibraryButton").addEventListener("click",()=>{els.menu.classList.add("hidden");state.library=[];saveLibrary();renderLibrary();showToast("Biblioteca limpa.");});

setInterval(()=>{
  if(!state.tracks.length)return;
  $$(".mix-card").forEach(card=>{const t=playingTrack(card.dataset.trackId);if(!t)return;const p=currentPosition(t),seek=card.querySelector(".track-seek");card.querySelector("[data-pos]").textContent=formatTime(p);if(seek&&!seek.matches(":active")){seek.max=Math.max(Number(t.duration)||0,p,1);seek.value=Math.min(p,Number(seek.max));updateRangeFill(seek,"#bb2029");}});
},500);

async function init(){
  if(!OBR.isAvailable){ state.role="GM";state.roomId="preview-room";state.playerId="preview";state.engineReady=true;loadLibrary();renderAll();els.loading.classList.add("hidden");return; }
  OBR.onReady(async()=>{
    state.roomId=OBR.room.id||"room"; state.playerId=OBR.player.id||"player"; state.role=await OBR.player.getRole(); loadLibrary();
    OBR.broadcast.onMessage(ENGINE_CHANNEL,event=>{const d=event.data;if(d?.type==="state")setEngineState(d.state);if(d?.type==="patch")applyEnginePatch(d.patch);if(d?.type==="audio-blocked")showToast("O navegador bloqueou uma faixa. Interaja com o Owlbear e tente tocar novamente.",4200);if(d?.type==="audio-error")showToast(`Não foi possível carregar: ${d.title||"faixa"}. Verifique o link.`,4200);});
    OBR.broadcast.onMessage(STATE_CHANNEL,event=>{const d=event.data;if(d?.type==="snapshot")setEngineState(d.state);if(d?.type==="patch")applyEnginePatch(d.patch);});
    await OBR.broadcast.sendMessage(CONTROL_CHANNEL,{type:"ui-state-request"},{destination:"LOCAL"});
    if(state.role!=="GM")await OBR.broadcast.sendMessage(CONTROL_CHANNEL,{type:"request-state"},{destination:"REMOTE"});
    renderAll();els.loading.classList.add("hidden");
  });
}
init();
