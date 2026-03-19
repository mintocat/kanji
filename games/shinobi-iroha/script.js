import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

// --- ゲーム設定 ---
const KANA_LIST = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやいゆえよらりるれろわをんー".split("");
const SHINOBI_BASE_PATH = "rooms/shinobi-iroha";

const HEN_CANDIDATES = ["人", "木", "水", "火", "土", "金", "身", "口", "日", "月"]; 
const TSUKURI_CANDIDATES = ["口", "力", "女", "子", "寸", "心", "立", "刀", "又", "巴"];

const QUESTION_SENTENCES = [
    "にんじゃのあんごうをときあかせ",
    "きょうはとてもいいてんきですね",
    "ふじさんのうえですいえいをする",
    "ぬすまれたのはあなたのこころです",
    "うしろのしょうめんだあれ",
    "ちりもつもればやまとなる",
    "いぬもあるけばぼうにあたる",
    "おわりのないのがおわり"
];

// --- 状態管理 ---
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myShinobiName') || "名無し忍者";

let roomPlayers = {};
let currentGameState = null;
let shinobiSvgMap = {}; 

// --- 音声演出 ---
const playSound = (type) => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        const now = ctx.currentTime;
        if (type === 'start') {
            osc.frequency.setValueAtTime(440, now); osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);
            gain.gain.setValueAtTime(0.05, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(); osc.stop(now + 0.2);
        } else if (type === 'correct') {
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const o = ctx.createOscillator(); const g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.frequency.setValueAtTime(freq, now + i * 0.1);
                g.gain.setValueAtTime(0.05, now + i * 0.1); g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
                o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.3);
            });
        }
    } catch(e) {}
};

// --- SVG合成 ---
async function getKanjiPaths(char) {
    const unicode = char.charCodeAt(0).toString(16).padStart(5, '0');
    const url = `https://cdn.jsdelivr.net/gh/kanjivg/kanjivg/kanji/${unicode}.svg`;
    try {
        const resp = await fetch(url);
        const text = await resp.text();
        const doc = new DOMParser().parseFromString(text, "image/svg+xml");
        return Array.from(doc.querySelectorAll('path')).map(p => p.getAttribute('d'));
    } catch(e) { return []; }
}

async function createCombinedSVG(henChar, tsukuriChar) {
    const henPaths = await getKanjiPaths(henChar);
    const tsukuriPaths = await getKanjiPaths(tsukuriChar);
    let combined = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">`;
    combined += `<g transform="scale(0.5, 1) translate(0, 0)">`;
    henPaths.forEach(d => combined += `<path d="${d}" fill="none" stroke="black" stroke-width="5" stroke-linecap="round"/>`);
    combined += `</g>`;
    combined += `<g transform="scale(0.5, 1) translate(100, 0)">`;
    tsukuriPaths.forEach(d => combined += `<path d="${d}" fill="none" stroke="black" stroke-width="5" stroke-linecap="round"/>`);
    combined += `</g>`;
    combined += `</svg>`;
    return combined;
}

// --- メインロジック ---
window.addEventListener('DOMContentLoaded', () => {
    if (!roomId) {
        document.getElementById('lobby-ui').classList.remove('hidden');
        document.getElementById('lobby-my-name').innerText = myName;
        document.getElementById('save-name-btn').onclick = () => {
            const val = document.getElementById('name-input').value.trim();
            if (val) {
                myName = val;
                localStorage.setItem('myShinobiName', val);
                document.getElementById('lobby-my-name').innerText = val;
                document.getElementById('room-controls').classList.remove('hidden');
                document.getElementById('name-setup').classList.add('hidden');
            }
        };
        if (localStorage.getItem('myShinobiName')) {
            document.getElementById('room-controls').classList.remove('hidden');
            document.getElementById('name-setup').classList.add('hidden');
        }
        document.getElementById('create-room-btn').onclick = async () => {
            const newRoomId = Math.floor(100 + Math.random() * 900).toString();
            await set(ref(db, `${SHINOBI_BASE_PATH}/${newRoomId}/state`), { status: "waiting", hostId: myId });
            window.location.href = `?room=${newRoomId}`;
        };
        document.getElementById('join-room-btn').onclick = () => {
            const inputId = document.getElementById('join-room-input').value.trim();
            if (inputId && inputId.length === 3) window.location.href = `?room=${inputId}`;
        };
    } else {
        document.getElementById('lobby-ui').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('display-room-id').innerText = roomId;
        document.getElementById('display-my-name').innerText = myName;

        set(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/players/${myId}`), myName);

        onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/players`), (snapshot) => {
            roomPlayers = snapshot.val() || {};
            document.getElementById('player-list').innerHTML = Object.values(roomPlayers).map(name => `<span class="player-tag">${name}</span>`).join('');
        });

        onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores`), (snapshot) => {
            const scores = snapshot.val() || {};
            const sorted = Object.entries(scores).sort((a,b) => b[1] - a[1]);
            document.getElementById('score-list').innerHTML = sorted.map(([pId, s]) => `<div class="score-item"><span>${roomPlayers[pId] || '...'}</span><span>${s}回</span></div>`).join('');
        });

        onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), async (snapshot) => {
            const data = snapshot.val();
            if (!data) return;
            currentGameState = data;
            const isHost = (data.hostId === myId);

            if (data.status === "waiting") {
                document.getElementById('start-btn').classList.toggle('hidden', !isHost);
                document.getElementById('play-screen').classList.add('hidden');
                document.getElementById('status-msg').innerText = "ホストを待機中...";
            } else if (data.status === "playing") {
                document.getElementById('start-btn').classList.add('hidden');
                document.getElementById('play-screen').classList.remove('hidden');
                document.getElementById('result-overlay').classList.add('hidden');
                
                if (Object.keys(shinobiSvgMap).length === 0) {
                    await buildShinobiMap(data.henChars, data.tsukuriChars);
                    renderDecodeTable(data.henChars, data.tsukuriChars);
                    renderCipherText(data.answer);
                    playSound('start');
                }
                document.getElementById('status-msg').innerText = "解読せよ！";
            } else if (data.status === "finished") {
                showResult(data);
            }

            const gVotes = data.gameVotes ? Object.keys(data.gameVotes).length : 0;
            const pCount = Object.keys(roomPlayers).length;
            document.getElementById('game-vote-count').innerText = `${gVotes}/${pCount}`;
            if (isHost && gVotes >= pCount && pCount > 0 && data.status === "finished") {
                setupNewGame();
            }
        });
    }
});

// --- 【修正済み】ゲーム開始処理 ---
async function setupNewGame() {
    const startBtn = document.getElementById('start-btn');
    startBtn.innerText = "生成中...";
    startBtn.disabled = true;

    try {
        const hen = shuffle([...HEN_CANDIDATES]).slice(0, 7);
        const tsu = shuffle([...TSUKURI_CANDIDATES]).slice(0, 7);
        const answer = shuffle([...QUESTION_SENTENCES])[0];

        await set(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), {
            henChars: hen,
            tsukuriChars: tsu,
            answer: answer,
            status: "playing",
            hostId: currentGameState.hostId, // 現在のホストを維持
            gameVotes: {} 
        });
    } catch (e) {
        console.error(e);
        alert("生成中にエラーが発生しました");
    } finally {
        startBtn.innerText = "新しい暗号を生成（ホストのみ）";
        startBtn.disabled = false;
    }
}

async function buildShinobiMap(hens, tsus) {
    shinobiSvgMap = {};
    let kanaIdx = 0;
    for (let h of hens) {
        for (let t of tsus) {
            if (kanaIdx < KANA_LIST.length) {
                const svg = await createCombinedSVG(h, t);
                shinobiSvgMap[KANA_LIST[kanaIdx]] = svg;
                kanaIdx++;
            }
        }
    }
}

function renderCipherText(answer) {
    const area = document.getElementById('cipher-area');
    area.innerHTML = '';
    answer.split("").forEach(char => {
        const div = document.createElement("div");
        if (char === " " || char === "　") {
            div.className = "cipher-char space";
        } else {
            div.className = "cipher-char";
            div.innerHTML = shinobiSvgMap[char] || "?";
        }
        area.appendChild(div);
    });
}

function renderDecodeTable(hens, tsus) {
    const table = document.getElementById('decode-table');
    table.innerHTML = '';
    table.appendChild(createCell("", "header-cell"));
    tsus.forEach(t => table.appendChild(createCell(t, "header-cell")));
    let kanaIdx = 0;
    hens.forEach(h => {
        table.appendChild(createCell(h, "header-cell")); 
        tsus.forEach(t => {
            if (kanaIdx < KANA_LIST.length) {
                const svg = shinobiSvgMap[KANA_LIST[kanaIdx]];
                const cell = createCell(svg, "cell");
                const input = document.createElement("input");
                input.type = "text";
                input.className = "memo-input";
                input.maxLength = 1;
                const memoKey = `shinobi_memo_${roomId}_${kanaIdx}`;
                input.value = localStorage.getItem(memoKey) || "";
                input.oninput = () => localStorage.setItem(memoKey, input.value);
                cell.appendChild(input);
                table.appendChild(cell);
                kanaIdx++;
            } else {
                table.appendChild(createCell("", "cell"));
            }
        });
    });
}

function createCell(content, className) {
    const div = document.createElement("div");
    div.className = className;
    if (content.startsWith("<svg")) div.innerHTML = content;
    else div.innerText = content;
    return div;
}

document.getElementById('submit-btn').onclick = () => {
    const input = document.getElementById('answer-input');
    const guess = input.value.trim().replace(/\s+/g, "");
    if (!guess) return;
    if (guess === currentGameState.answer) {
        update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), { status: "finished", winner: myName });
        onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores/${myId}`), (s) => {
            update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores`), { [myId]: (s.val() || 0) + 1 });
        }, { onlyOnce: true });
        playSound('correct');
        input.value = "";
    } else {
        document.getElementById('status-msg').innerText = "違います！";
        setTimeout(() => document.getElementById('status-msg').innerText = "解読せよ！", 1500);
    }
};

function showResult(data) {
    document.getElementById('result-overlay').classList.remove('hidden');
    document.getElementById('winner-msg').innerText = `勝者：${data.winner || '不明'}`;
    document.getElementById('correct-answer').innerText = data.answer;
    shinobiSvgMap = {}; 
}

document.getElementById('next-game-btn').onclick = () => {
    for(let i=0; i<KANA_LIST.length; i++) localStorage.removeItem(`shinobi_memo_${roomId}_${i}`);
    update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state/gameVotes`), { [myId]: true });
};

document.getElementById('start-btn').onclick = setupNewGame;

// --- 【修正済み】配列をシャッフルする関数 ---
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]; 
    }
    return array;
}
