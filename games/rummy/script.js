import { db, ref, set, onValue, update } from '../../js/firebase-config.js';
import { KANJI_LOGIC_DATA } from './kanji_logic.js';

// --- 音声生成エンジン ---
const AudioEngine = {
    ctx: null,
    init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
    playSelect() {
        this.init(); const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
        osc.connect(gain); gain.connect(this.ctx.destination); osc.start(); osc.stop(this.ctx.currentTime + 0.1);
    },
    playDraw() {
        this.init(); const bufferSize = this.ctx.sampleRate * 0.1; const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0); for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource(); noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter(); filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1000, this.ctx.currentTime); filter.frequency.exponentialRampToValueAtTime(3000, this.ctx.currentTime + 0.1);
        const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
        noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination); noise.start();
    },
    playSuccess() {
        this.init(); [1200, 1500, 1800].forEach((freq, i) => {
            const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq, this.ctx.currentTime + i*0.05);
            gain.gain.setValueAtTime(0.1, this.ctx.currentTime + i*0.05); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
            osc.connect(gain); gain.connect(this.ctx.destination); osc.start(this.ctx.currentTime + i*0.05); osc.stop(this.ctx.currentTime + 0.4);
        });
    },
    playError() {
        this.init(); const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(120, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(100, this.ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime); gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
        osc.connect(gain); gain.connect(this.ctx.destination); osc.start(); osc.stop(this.ctx.currentTime + 0.3);
    }
};

const g1 = "口,木,艹,⺡,日,⺘,⺅,金,一,女,土,火,山,丶,言,丿,糹,⺖,田,大,十,⺮,心,宀,石,亠,貝".split(",");
const g2 = "禾,又,目,⺼,辶,厶,隹,⺉,力,攵,勹,人,車,疒,寸,米,广,冖,夂,⺨,儿,⻖,酉,頁,彳,几,囗".split(",");
const g3 = "尸,月,𠂉,厂,子,王,方,匕,白,斤,皿,䒑,灬,止,工,小,廾,夕,衣,𠂇,立,八,刀,匚,戈,巾,士".split(",");
const g4 = "虍,爫,冂,示,豆,門,耳,羽,兀,㔾,⻗,㐅,欠,丁,⺊,龷,糸,比,⺧,⺌,耂,戊,干,而,丂,户,魚,殳".split(",");

function drawTane() {
    const r = Math.random() * 100;
    const group = r < 30 ? g1 : r < 57 ? g2 : r < 80 ? g3 : g4;
    return group[Math.floor(Math.random() * group.length)];
}

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myKanjiName') || "名無しさん";

let currentGameState = null;
let roomPlayers = {};
let selectedHandIndices = []; 
let selectedPublicIndex = -1; 

let prevHandLength = 0;
let prevPublicLength = 0;

window.selectHand = (i) => {
    AudioEngine.playSelect();
    if (selectedHandIndices.includes(i)) selectedHandIndices = selectedHandIndices.filter(idx => idx !== i);
    else selectedHandIndices.push(i);
    render(currentGameState);
};

window.selectPublic = (i) => {
    AudioEngine.playSelect();
    selectedPublicIndex = (selectedPublicIndex === i) ? -1 : i;
    render(currentGameState);
};

window.addEventListener('DOMContentLoaded', () => { if (!roomId) initLobby(); else initGame(); });

function initLobby() {
    const nameDisplay = document.getElementById('lobby-my-name');
    nameDisplay.innerText = myName;
    document.getElementById('save-name-btn').onclick = () => {
        const v = document.getElementById('name-input').value.trim();
        if(v) { myName = v; localStorage.setItem('myKanjiName', v); nameDisplay.innerText = v; alert("保存完了"); }
    };
    document.getElementById('create-room-btn').onclick = async () => {
        const id = Math.floor(100 + Math.random() * 900).toString();
        const hSize = parseInt(document.getElementById('setting-hand-size').value) || 10;
        const life = parseInt(document.getElementById('setting-life').value) || 3;
        await set(ref(db, `rooms/kanji-rummy/${id}/state`), { status:"waiting", hostId:myId, settings:{hSize, life} });
        window.location.href = `?room=${id}`;
    };
    document.getElementById('join-room-btn').onclick = () => {
        const id = document.getElementById('join-room-input').value.trim();
        if(id) window.location.href = `?room=${id}`;
    };
}

function initGame() {
    document.getElementById('lobby-ui').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    document.getElementById('display-room-id').innerText = roomId;
    set(ref(db, `rooms/kanji-rummy/${roomId}/players/${myId}`), { name: myName });
    onValue(ref(db, `rooms/kanji-rummy/${roomId}/players`), s => { roomPlayers = s.val() || {}; if(currentGameState) render(currentGameState); });
    onValue(ref(db, `rooms/kanji-rummy/${roomId}/state`), s => {
        const state = s.val();
        if(!state) return;
        if (currentGameState && state.publicArea && state.publicArea.length > (currentGameState.publicArea?.length || 0)) AudioEngine.playSuccess();
        currentGameState = state;
        render(state);
    });
    document.getElementById('start-btn').onclick = setupGame;
    document.getElementById('deck-pile').onclick = () => handleDraw("deck");
    document.getElementById('discard-pile').onclick = () => handleDraw("discard");
    document.getElementById('btn-discard').onclick = handleDiscard;
    document.getElementById('btn-melt').onclick = handleMelt;
    document.getElementById('btn-attach').onclick = handleAttach;
}

async function setupGame() {
    const pIds = Object.keys(roomPlayers);
    const { hSize, life } = currentGameState.settings;
    const hands = {}; const lives = {};
    pIds.forEach(id => { hands[id] = Array.from({length:hSize}, () => drawTane()); lives[id] = life; });
    await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), { status: "playing", turnOrder: pIds, currentTurnIndex: 0, hands, lives, discardPile: [drawTane()], publicArea: [], phase: "draw" });
}

function render(state) {
    if(!state) return;
    const isMyTurn = state.turnOrder && state.turnOrder[state.currentTurnIndex] === myId;
    const phase = state.phase;
    const canAction = isMyTurn && phase === "action";
    
    document.getElementById('btn-melt').disabled = !canAction || selectedHandIndices.length < 2;
    document.getElementById('btn-attach').disabled = !canAction || selectedHandIndices.length !== 1 || selectedPublicIndex === -1;
    document.getElementById('btn-discard').disabled = !canAction || selectedHandIndices.length !== 1;
    
    const startBtn = document.getElementById('start-btn');
    if(state.status === "waiting" && state.hostId === myId) startBtn.classList.remove('hidden'); else startBtn.classList.add('hidden');
    
    const statusArea = document.getElementById('player-status-area');
    if(state.turnOrder) {
        statusArea.innerHTML = state.turnOrder.map((id, i) => {
            const active = i === state.currentTurnIndex ? 'active-turn' : '';
            return `<div class="player-card ${active}">${roomPlayers[id]?.name || "..."}(HP:${state.lives[id]} / 🎴:${state.hands[id]?.length || 0})</div>`;
        }).join('');
    }

    document.getElementById('discard-pile').innerText = (state.discardPile || []).slice(-1)[0] || "-";

    const pubArea = document.getElementById('public-area');
    const currentPublic = state.publicArea || [];
    const isNewPublicAdded = currentPublic.length > prevPublicLength;
    pubArea.innerHTML = currentPublic.map((kanji, i) => {
        const animClass = (isNewPublicAdded && i === currentPublic.length - 1) ? 'anim-success' : '';
        return `<div class="melted-kanji ${selectedPublicIndex === i ? 'selected' : ''} ${animClass}" onclick="selectPublic(${i})">${kanji}</div>`;
    }).join('');

    const handCont = document.getElementById('my-hand-container');
    const myHand = (state.hands && state.hands[myId]) || [];
    const isNewHandAdded = myHand.length > prevHandLength;
    handCont.innerHTML = myHand.map((t, i) => {
        const isSelected = selectedHandIndices.includes(i) ? 'selected' : '';
        const animClass = (isNewHandAdded && i === myHand.length - 1) ? 'anim-draw' : '';
        return `<div class="tane-card ${isSelected} ${animClass}" onclick="selectHand(${i})">${t}</div>`;
    }).join('');

    prevHandLength = myHand.length;
    prevPublicLength = currentPublic.length;

    const sysMsg = document.getElementById('system-msg');
    if(isMyTurn) sysMsg.innerText = (phase === "draw") ? "札を引いてください。" : "捨てる札を選ぶか、合体させてください。";
    else sysMsg.innerText = state.status === "waiting" ? "待機中..." : "相手の番です...";
}

async function handleDraw(type) {
    if (!currentGameState || currentGameState.phase !== "draw" || currentGameState.turnOrder[currentGameState.currentTurnIndex] !== myId) return;
    AudioEngine.playDraw();
    let newTane; let newDiscard = [...currentGameState.discardPile];
    if (type === "deck") newTane = drawTane(); else { if(newDiscard.length === 0) return; newTane = newDiscard.pop(); }
    const newHand = [...(currentGameState.hands[myId] || []), newTane];
    await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), { [`hands/${myId}`]: newHand, discardPile: newDiscard, phase: "action" });
}

async function handleDiscard() {
    if(selectedHandIndices.length !== 1) return;
    AudioEngine.playSelect(); // 捨てた時の音を追加
    const idx = selectedHandIndices[0]; const myHand = [...currentGameState.hands[myId]]; const discarded = myHand.splice(idx, 1)[0];
    const nextIdx = (currentGameState.currentTurnIndex + 1) % currentGameState.turnOrder.length;
    selectedHandIndices = [];
    await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), { [`hands/${myId}`]: myHand, discardPile: [...currentGameState.discardPile, discarded], currentTurnIndex: nextIdx, phase: "draw" });
}

// --- 合体判定ロジック（強化・修正版） ---

function decomposeToSeeds(parts) {
    if (!Array.isArray(parts)) return []; // 安全策
    let seeds = [];
    parts.forEach(part => {
        // 定義があり、レシピが存在する場合のみ再帰的に分解
        if (KANJI_LOGIC_DATA[part] && Array.isArray(KANJI_LOGIC_DATA[part]) && KANJI_LOGIC_DATA[part].length > 0) {
            seeds.push(...decomposeToSeeds(KANJI_LOGIC_DATA[part][0]));
        } else {
            seeds.push(part);
        }
    });
    return seeds;
}

function findMeltableKanji(selectedParts) {
    const userSeedsSorted = decomposeToSeeds(selectedParts).sort().join("");
    for (const [targetKanji, recipes] of Object.entries(KANJI_LOGIC_DATA)) {
        for (const recipeParts of recipes) {
            const recipeSeedsSorted = decomposeToSeeds(recipeParts).sort().join("");
            if (userSeedsSorted === recipeSeedsSorted) return targetKanji;
        }
    }
    return null;
}

async function handleMelt() {
    if(selectedHandIndices.length < 2) return;
    AudioEngine.playSelect(); // クリック時の音を追加
    const myHand = [...currentGameState.hands[myId]]; const selectedTanes = selectedHandIndices.map(i => myHand[i]);
    const foundKanji = findMeltableKanji(selectedTanes);
    if (foundKanji) {
        selectedHandIndices.sort((a,b) => b-a).forEach(i => myHand.splice(i, 1));
        const newPublic = [...(currentGameState.publicArea || []), foundKanji];
        await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), { [`hands/${myId}`]: myHand, publicArea: newPublic });
        selectedHandIndices = [];
    } else {
        reduceLife();
    }
}

async function handleAttach() {
    if (selectedHandIndices.length !== 1 || selectedPublicIndex === -1) return;
    AudioEngine.playSelect(); // クリック時の音を追加
    const myHand = [...currentGameState.hands[myId]]; const handPart = myHand[selectedHandIndices[0]];
    const boardKanji = currentGameState.publicArea[selectedPublicIndex];
    const found = findMeltableKanji([handPart, boardKanji]);
    if (found) {
        myHand.splice(selectedHandIndices[0], 1); const newPublic = [...currentGameState.publicArea];
        newPublic[selectedPublicIndex] = found;
        await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), { [`hands/${myId}`]: myHand, publicArea: newPublic });
        selectedHandIndices = []; selectedPublicIndex = -1;
    } else {
        reduceLife();
    }
}

async function reduceLife() {
    AudioEngine.playError();
    document.getElementById('game-ui').classList.add('anim-shake');
    setTimeout(() => document.getElementById('game-ui').classList.remove('anim-shake'), 400);
    const newLife = currentGameState.lives[myId] - 1;
    alert("合体失敗！");
    await update(ref(db, `rooms/kanji-rummy/${roomId}/state/lives`), { [myId]: newLife });
    selectedHandIndices = [];
}
