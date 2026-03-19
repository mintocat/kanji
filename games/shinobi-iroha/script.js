import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

// --- 設定 ---
const KANA_LIST = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやいゆえよらりるれろわをんー".split("");
const SHINOBI_BASE_PATH = "rooms/shinobi-iroha";

const HEN_CANDIDATES = ["人", "木", "水", "火", "土", "金", "身", "口", "日", "月"]; 
const TSUKURI_CANDIDATES = ["口", "力", "女", "子", "寸", "心", "立", "刀", "又", "巴"];

const QUESTION_SENTENCES = [
    "にんじゃのあんごうをときあかせ",
    "きょうはとてもいい天気ですね",
    "ふじさんのうえですいえいをする",
    "ぬすまれたのはあなたのこころです",
    "うしろのしょうめんだあれ",
    "ちりもつもればやまとなる",
    "いぬもあるけばぼうにあたる",
    "おわりのないのがおわり",
    "あしたはあしたのかぜがふく"
];

let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myShinobiName') || "";
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

let roomPlayers = {};
let currentGameState = null;
let shinobiSvgMap = {};

// --- ユーティリティ ---
const shuffle = (array) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

const getKanjiPaths = async (char) => {
    const unicode = char.charCodeAt(0).toString(16).padStart(5, '0');
    const url = `https://cdn.jsdelivr.net/gh/kanjivg/kanjivg/kanji/${unicode}.svg`;
    try {
        const resp = await fetch(url);
        const text = await resp.text();
        const doc = new DOMParser().parseFromString(text, "image/svg+xml");
        return Array.from(doc.querySelectorAll('path')).map(p => p.getAttribute('d'));
    } catch(e) { return []; }
};

const createCombinedSVG = async (henChar, tsukuriChar) => {
    const henPaths = await getKanjiPaths(henChar);
    const tsukuriPaths = await getKanjiPaths(tsukuriChar);
    let combined = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">`;
    combined += `<g transform="scale(0.5, 1)">`;
    henPaths.forEach(d => combined += `<path d="${d}" fill="none" stroke="black" stroke-width="5" stroke-linecap="round"/>`);
    combined += `</g><g transform="scale(0.5, 1) translate(100, 0)">`;
    tsukuriPaths.forEach(d => combined += `<path d="${d}" fill="none" stroke="black" stroke-width="5" stroke-linecap="round"/>`);
    combined += `</g></svg>`;
    return combined;
};

// --- ゲーム処理 ---
window.addEventListener('DOMContentLoaded', () => {
    if (!roomId) {
        setupLobby();
    } else {
        setupGame();
    }
});

function setupLobby() {
    const lobbyUi = document.getElementById('lobby-ui');
    const controls = document.getElementById('room-controls');
    const nameSetup = document.getElementById('name-setup');

    if (myName) {
        nameSetup.classList.add('hidden');
        controls.classList.remove('hidden');
        document.getElementById('lobby-my-name').innerText = myName;
    }

    document.getElementById('save-name-btn').onclick = () => {
        const val = document.getElementById('name-input').value.trim();
        if (val) {
            myName = val;
            localStorage.setItem('myShinobiName', val);
            location.reload();
        }
    };

    document.getElementById('create-room-btn').onclick = async () => {
        const id = Math.floor(100 + Math.random() * 900).toString();
        await set(ref(db, `${SHINOBI_BASE_PATH}/${id}/state`), { status: "waiting", hostId: myId });
        window.location.href = `?room=${id}`;
    };

    document.getElementById('join-room-btn').onclick = () => {
        const id = document.getElementById('join-room-input').value.trim();
        if (id.length === 3) window.location.href = `?room=${id}`;
    };
}

async function setupGame() {
    document.getElementById('game-ui').classList.remove('hidden');
    document.getElementById('display-room-id').innerText = roomId;
    document.getElementById('display-my-name').innerText = myName;

    set(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/players/${myId}`), myName);

    onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/players`), (snap) => {
        roomPlayers = snap.val() || {};
        document.getElementById('player-list').innerHTML = Object.values(roomPlayers).map(n => `<span class="player-tag">${n}</span>`).join('');
    });

    onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores`), (snap) => {
        const scores = snap.val() || {};
        document.getElementById('score-list').innerHTML = Object.entries(scores).sort((a,b)=>b[1]-a[1]).map(([id, s]) => 
            `<div class="score-item"><span>${roomPlayers[id] || '...'}</span><span>${s}回</span></div>`
        ).join('');
    });

    onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), async (snap) => {
        const data = snap.val();
        if (!data) return;
        currentGameState = data;
        const isHost = data.hostId === myId;

        if (data.status === "waiting") {
            document.getElementById('start-btn').classList.toggle('hidden', !isHost);
            document.getElementById('play-screen').classList.add('hidden');
            document.getElementById('status-msg').innerText = "待機中...";
        } else if (data.status === "playing") {
            document.getElementById('start-btn').classList.add('hidden');
            document.getElementById('play-screen').classList.remove('hidden');
            document.getElementById('result-overlay').classList.add('hidden');
            
            // 地図の構築
            if (Object.keys(shinobiSvgMap).length === 0) {
                await buildMap(data.henChars, data.tsukuriChars);
                renderTable(data.henChars, data.tsukuriChars);
                renderCipher(data.answer);
            }
        } else if (data.status === "finished") {
            document.getElementById('result-overlay').classList.remove('hidden');
            document.getElementById('winner-msg').innerText = `勝者: ${data.winner}`;
            document.getElementById('correct-answer').innerText = data.answer;
        }

        const votes = data.gameVotes ? Object.keys(data.gameVotes).length : 0;
        document.getElementById('game-vote-count').innerText = `${votes}/${Object.keys(roomPlayers).length}`;
        if (isHost && votes >= Object.keys(roomPlayers).length && votes > 0 && data.status === "finished") {
            setupNewGame();
        }
    });

    document.getElementById('start-btn').onclick = setupNewGame;
    document.getElementById('submit-btn').onclick = submitAnswer;
    document.getElementById('next-game-btn').onclick = () => {
        update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state/gameVotes`), { [myId]: true });
    };
}

async function setupNewGame() {
    const btn = document.getElementById('start-btn');
    btn.innerText = "生成中..."; btn.disabled = true;
    try {
        const hen = shuffle(HEN_CANDIDATES).slice(0, 7);
        const tsu = shuffle(TSUKURI_CANDIDATES).slice(0, 7);
        const ans = shuffle(QUESTION_SENTENCES)[0];
        shinobiSvgMap = {};
        await set(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), {
            henChars: hen, tsukuriChars: tsu, answer: ans,
            status: "playing", hostId: currentGameState.hostId, gameVotes: {}
        });
    } catch (e) { alert("生成失敗"); }
    finally { btn.innerText = "新しい暗号を生成（ホストのみ）"; btn.disabled = false; }
}

async function buildMap(hens, tsus) {
    let idx = 0;
    for (let h of hens) {
        for (let t of tsus) {
            if (idx < KANA_LIST.length) {
                shinobiSvgMap[KANA_LIST[idx]] = await createCombinedSVG(h, t);
                idx++;
            }
        }
    }
}

function renderCipher(ans) {
    const area = document.getElementById('cipher-area');
    area.innerHTML = '';
    ans.split('').forEach(c => {
        const d = document.createElement('div');
        d.className = (c === ' ' || c === '　') ? "cipher-char space" : "cipher-char";
        d.innerHTML = shinobiSvgMap[c] || c;
        area.appendChild(d);
    });
}

function renderTable(hens, tsus) {
    const table = document.getElementById('decode-table');
    table.innerHTML = '';
    table.appendChild(createCell("", "header-cell"));
    tsus.forEach(t => table.appendChild(createCell(t, "header-cell")));
    let idx = 0;
    hens.forEach(h => {
        table.appendChild(createCell(h, "header-cell"));
        tsus.forEach(t => {
            if (idx < KANA_LIST.length) {
                const cell = createCell(shinobiSvgMap[KANA_LIST[idx]], "cell");
                const input = document.createElement('input');
                input.className = "memo-input"; input.maxLength = 1;
                const key = `memo_${roomId}_${idx}`;
                input.value = localStorage.getItem(key) || "";
                input.oninput = () => localStorage.setItem(key, input.value);
                cell.appendChild(input);
                table.appendChild(cell);
                idx++;
            }
        });
    });
}

function createCell(html, cls) {
    const d = document.createElement('div'); d.className = cls;
    d.innerHTML = html; return d;
}

function submitAnswer() {
    const guess = document.getElementById('answer-input').value.trim().replace(/\s/g, '');
    if (guess === currentGameState.answer.replace(/\s/g, '')) {
        update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), { status: "finished", winner: myName });
        onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores/${myId}`), (s) => {
            update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores`), { [myId]: (s.val() || 0) + 1 });
        }, { onlyOnce: true });
        document.getElementById('answer-input').value = '';
    } else {
        document.getElementById('status-msg').innerText = "不正解！";
        setTimeout(()=> document.getElementById('status-msg').innerText = "解読せよ！", 1000);
    }
}
