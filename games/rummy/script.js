import { db, ref, set, onValue, update } from '../../js/firebase-config.js';
import { KANJI_LOGIC_DATA } from './kanji_logic.js';

// --- たねリスト定義 ---
const g1 = "口,木,艹,⺡,日,⺘,⺅,金,一,女,土,火,山,丶,言,丿,糹,⺖,田,大,十,⺮,心,宀,石,亠,貝".split(",");
const g2 = "禾,又,目,⺼,辶,厶,隹,⺉,力,攵,勹,人,車,疒,寸,米,广,冖,夂,⺨,儿,⻖,酉,頁,彳,几,囗".split(",");
const g3 = "尸,月,𠂉,厂,子,王,方,匕,白,斤,皿,䒑,灬,止,工,小,廾,夕,衣,𠂇,立,八,刀,匚,戈,巾,士".split(",");
const g4 = "虍,爫,冂,示,豆,門,耳,羽,兀,㔾,⻗,㐅,欠,丁,⺊,龷,糸,比,⺧,⺌,耂,戊,干,而,丂,户,魚,殳".split(",");

// --- ユーティリティ ---
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

// --- HTMLから呼び出せるように window オブジェクトに登録 ---
window.selectHand = (i) => {
    if (selectedHandIndices.includes(i)) {
        selectedHandIndices = selectedHandIndices.filter(idx => idx !== i);
    } else {
        selectedHandIndices.push(i);
    }
    render(currentGameState);
};

window.selectPublic = (i) => {
    selectedPublicIndex = (selectedPublicIndex === i) ? -1 : i;
    render(currentGameState);
};

// --- 初期化 ---
window.addEventListener('DOMContentLoaded', () => {
    if (!roomId) {
        initLobby();
    } else {
        initGame();
    }
});

function initLobby() {
    const nameDisplay = document.getElementById('lobby-my-name');
    const saveNameBtn = document.getElementById('save-name-btn');
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');

    nameDisplay.innerText = myName;

    saveNameBtn.onclick = () => {
        const v = document.getElementById('name-input').value.trim();
        if(v) { 
            myName = v; 
            localStorage.setItem('myKanjiName', v); 
            nameDisplay.innerText = v;
            alert("名前を保存しました: " + v);
        }
    };

    createRoomBtn.onclick = async () => {
        const id = Math.floor(100 + Math.random() * 900).toString();
        const hSize = parseInt(document.getElementById('setting-hand-size').value) || 10;
        const life = parseInt(document.getElementById('setting-life').value) || 3;
        
        console.log("ルーム作成中...", id);
        try {
            await set(ref(db, `rooms/kanji-rummy/${id}/state`), { 
                status:"waiting", 
                hostId:myId, 
                settings:{hSize, life} 
            });
            window.location.href = `?room=${id}`;
        } catch (e) {
            console.error("ルーム作成エラー:", e);
        }
    };

    joinRoomBtn.onclick = () => {
        const id = document.getElementById('join-room-input').value.trim();
        if(id) window.location.href = `?room=${id}`;
    };
}

function initGame() {
    document.getElementById('lobby-ui').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    document.getElementById('display-room-id').innerText = roomId;

    // プレイヤー登録
    set(ref(db, `rooms/kanji-rummy/${roomId}/players/${myId}`), { name: myName });

    onValue(ref(db, `rooms/kanji-rummy/${roomId}/players`), s => { 
        roomPlayers = s.val() || {}; 
        if(currentGameState) render(currentGameState);
    });

    onValue(ref(db, `rooms/kanji-rummy/${roomId}/state`), s => {
        const state = s.val();
        if(!state) return;
        currentGameState = state;
        render(state);
    });

    // 各ボタンイベント（onclickプロパティで登録）
    document.getElementById('start-btn').onclick = setupGame;
    document.getElementById('deck-pile').onclick = () => handleDraw("deck");
    document.getElementById('discard-pile').onclick = () => handleDraw("discard");
    document.getElementById('btn-discard').onclick = handleDiscard;
    document.getElementById('btn-melt').onclick = handleMelt;
    document.getElementById('btn-attach').onclick = handleAttach;
}

// --- ゲーム開始（配牌） ---
async function setupGame() {
    const pIds = Object.keys(roomPlayers);
    if(pIds.length < 1) return; // 本番は < 2 に

    const { hSize, life } = currentGameState.settings;
    const hands = {}; 
    const lives = {};
    
    pIds.forEach(id => {
        hands[id] = Array.from({length:hSize}, () => drawTane());
        lives[id] = life;
    });

    await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), {
        status: "playing", 
        turnOrder: pIds, 
        currentTurnIndex: 0,
        hands: hands, 
        lives: lives, 
        discardPile: [drawTane()], 
        publicArea: [], 
        phase: "draw"
    });
}

// --- 画面描画 ---
function render(state) {
    if(!state) return;
    const isMyTurn = state.turnOrder && state.turnOrder[state.currentTurnIndex] === myId;
    
    // ホスト用開始ボタン
    const startBtn = document.getElementById('start-btn');
    if(state.status === "waiting" && state.hostId === myId) {
        startBtn.classList.remove('hidden');
    } else {
        startBtn.classList.add('hidden');
    }
    
    // プレイヤー状態
    const statusArea = document.getElementById('player-status-area');
    if(state.turnOrder) {
        statusArea.innerHTML = state.turnOrder.map((id, i) => {
            const active = i === state.currentTurnIndex ? 'active-turn' : '';
            const pName = roomPlayers[id]?.name || "待機中...";
            return `<div class="player-card ${active}">${pName} (HP:${state.lives[id]} / 🎴:${state.hands[id]?.length})</div>`;
        }).join('');
    }

    // 捨て札
    const discardPile = state.discardPile || [];
    const topDiscard = discardPile.length > 0 ? discardPile[discardPile.length - 1] : "-";
    document.getElementById('discard-pile').innerText = topDiscard;

    // 公開エリア
    const pubArea = document.getElementById('public-area');
    pubArea.innerHTML = (state.publicArea || []).map((kanji, i) => 
        `<div class="melted-kanji ${selectedPublicIndex === i ? 'selected' : ''}" onclick="selectPublic(${i})">${kanji}</div>`
    ).join('');

    // 手札
    const handCont = document.getElementById('my-hand-container');
    const myHand = (state.hands && state.hands[myId]) || [];
    handCont.innerHTML = myHand.map((t, i) => 
        `<div class="tane-card ${selectedHandIndices.includes(i) ? 'selected' : ''}" onclick="selectHand(${i})">${t}</div>`
    ).join('');

    // ボタン制御
    const phase = state.phase;
    document.getElementById('btn-melt').disabled = !isMyTurn || phase !== "action" || selectedHandIndices.length < 2;
    document.getElementById('btn-attach').disabled = !isMyTurn || phase !== "action" || selectedHandIndices.length !== 1 || selectedPublicIndex === -1;
    document.getElementById('btn-discard').disabled = !isMyTurn || phase !== "action" || selectedHandIndices.length !== 1;
    
    const sysMsg = document.getElementById('system-msg');
    if(isMyTurn) {
        sysMsg.innerText = phase === "draw" ? "山札か捨て札を引いてください" : "アクションを選ぶか、不要な1枚を捨ててください";
    } else {
        sysMsg.innerText = state.status === "waiting" ? "他の参加者を待っています..." : "相手の番です";
    }
}

// --- 以下、ロジック部分は変更なし ---
async function handleDraw(type) {
    if (!currentGameState || currentGameState.phase !== "draw") return;
    if (currentGameState.turnOrder[currentGameState.currentTurnIndex] !== myId) return;

    let newTane;
    let newDiscard = [...currentGameState.discardPile];
    if (type === "deck") {
        newTane = drawTane();
    } else {
        if(newDiscard.length === 0) return;
        newTane = newDiscard.pop();
    }

    const newHand = [...(currentGameState.hands[myId] || []), newTane];
    await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), {
        [`hands/${myId}`]: newHand, 
        discardPile: newDiscard, 
        phase: "action"
    });
}

async function handleDiscard() {
    if(selectedHandIndices.length !== 1) return;
    const idx = selectedHandIndices[0];
    const myHand = [...currentGameState.hands[myId]];
    const discarded = myHand.splice(idx, 1)[0];
    
    if (myHand.length === 0) alert("上がり！おめでとうございます！");

    const nextIdx = (currentGameState.currentTurnIndex + 1) % currentGameState.turnOrder.length;
    selectedHandIndices = [];
    await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), {
        [`hands/${myId}`]: myHand,
        discardPile: [...currentGameState.discardPile, discarded],
        currentTurnIndex: nextIdx,
        phase: "draw"
    });
}

function findMeltableKanji(tanes) {
    for (const [kanji, combinations] of Object.entries(KANJI_LOGIC_DATA)) {
        for (const combo of combinations) {
            if (combo.length === tanes.length && combo.every(t => tanes.includes(t))) return kanji;
        }
    }
    return null;
}

async function handleMelt() {
    const myHand = [...currentGameState.hands[myId]];
    const selectedTanes = selectedHandIndices.map(i => myHand[i]);
    const foundKanji = findMeltableKanji(selectedTanes);

    if (foundKanji) {
        selectedHandIndices.sort((a,b) => b-a).forEach(i => myHand.splice(i, 1));
        const newPublic = [...(currentGameState.publicArea || []), foundKanji];
        await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), { 
            [`hands/${myId}`]: myHand, 
            publicArea: newPublic 
        });
        selectedHandIndices = [];
        if (myHand.length === 0) alert("上がり！");
    } else {
        reduceLife();
    }
}

async function handleAttach() {
    const myHand = [...currentGameState.hands[myId]];
    const tane = myHand[selectedHandIndices[0]];
    const baseKanji = currentGameState.publicArea[selectedPublicIndex];
    
    let found = null;
    for (const [kanji, combos] of Object.entries(KANJI_LOGIC_DATA)) {
        if (combos.some(c => c.includes(tane) && c.includes(baseKanji) && c.length === 2)) {
            found = kanji; break;
        }
    }

    if (found) {
        myHand.splice(selectedHandIndices[0], 1);
        const newPublic = [...currentGameState.publicArea];
        newPublic[selectedPublicIndex] = found;
        await update(ref(db, `rooms/kanji-rummy/${roomId}/state`), { 
            [`hands/${myId}`]: myHand, 
            publicArea: newPublic 
        });
        selectedHandIndices = []; 
        selectedPublicIndex = -1;
        if (myHand.length === 0) alert("上がり！");
    } else {
        reduceLife();
    }
}

async function reduceLife() {
    const newLife = currentGameState.lives[myId] - 1;
    alert("合体失敗！ライフ減少！");
    await update(ref(db, `rooms/kanji-rummy/${roomId}/state/lives`), { [myId]: newLife });
    if (newLife <= 0) alert("負けが決定しました...");
    selectedHandIndices = [];
}
