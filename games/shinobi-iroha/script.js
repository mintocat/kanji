import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

// --- ゲーム設定 ---
const KANA_LIST = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやいゆえよらりるれろわをんー".split("");
const SHINOBI_BASE_PATH = "rooms/shinobi-iroha";
const KVG_NS = "http://kanjivg.tagaini.net"; // KanjiVGの正式な名前空間URL

// 偏と旁の候補
const HEN_CANDIDATES = ["録", "時", "討", "村", "海", "焼", "地", "休", "呼", "肝"]; 
const TSUKURI_CANDIDATES = ["討", "和", "功", "汝", "好", "沁", "粒", "初", "取", "肥"];

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
let myName = localStorage.getItem('myShinobiName') || ""; 

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
            osc.frequency.setValueAtTime(440, now);
            gain.gain.setValueAtTime(0.05, now);
            osc.start(); osc.stop(now + 0.2);
        } else if (type === 'correct') {
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const o = ctx.createOscillator(); const g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.frequency.setValueAtTime(freq, now + i * 0.1);
                g.gain.setValueAtTime(0.05, now + i * 0.1);
                o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.3);
            });
        }
    } catch(e) {}
};

// --- 【最終修正】部位抽出ロジック ---
async function getKanjiPartPaths(char, position) {
    const unicode = char.charCodeAt(0).toString(16).padStart(5, '0');
    const url = `https://cdn.jsdelivr.net/gh/kanjivg/kanjivg/kanji/${unicode}.svg`;
    
    try {
        const resp = await fetch(url);
        if (!resp.ok) return [];
        const text = await resp.text();
        const doc = new DOMParser().parseFromString(text, "image/svg+xml");
        
        let paths = [];
        const groups = Array.from(doc.getElementsByTagName('g'));
        
        // 正確に「偏(left)」または「旁(right)」のグループを探す
        const targetGroup = groups.find(g => {
            // 名前空間付き属性、または通常の属性の両方をチェック
            return g.getAttributeNS(KVG_NS, 'position') === position || 
                   g.getAttribute('kvg:position') === position;
        });

        if (targetGroup) {
            // そのグループに含まれる全パスのd属性を取得
            Array.from(targetGroup.getElementsByTagName('path')).forEach(p => {
                const d = p.getAttribute('d');
                if (d) paths.push(d);
            });
        }
        
        return paths;
    } catch(e) {
        console.error("SVG取得エラー:", e);
        return [];
    }
}

async function createCombinedSVG(henChar, tsukuriChar) {
    const henPaths = await getKanjiPartPaths(henChar, "left");
    const tsukuriPaths = await getKanjiPartPaths(tsukuriChar, "right");

    // どちらかが取得できなくても、空のSVGにならないよう最低限の描画を行う
    let combined = `<svg viewBox="0 0 109 109" xmlns="http://www.w3.org/2000/svg">`;
    const style = `fill="none" stroke="black" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"`;

    henPaths.forEach(d => { combined += `<path d="${d}" ${style} />`; });
    tsukuriPaths.forEach(d => { combined += `<path d="${d}" ${style} />`; });
    
    combined += `</svg>`;
    return combined;
}

// --- メインロジック ---
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('lobby-ui').classList.remove('hidden');
    document.getElementById('game-ui').classList.add('hidden');

    const updateUIState = () => {
        document.getElementById('lobby-my-name').innerText = myName || "未設定";
        if (myName) {
            document.getElementById('name-setup').classList.add('hidden');
            if (!roomId) {
                document.getElementById('room-controls').classList.remove('hidden');
            } else {
                enterGame(); 
            }
        } else {
            document.getElementById('name-setup').classList.remove('hidden');
            document.getElementById('room-controls').classList.add('hidden');
        }
    };

    document.getElementById('save-name-btn').onclick = () => {
        const val = document.getElementById('name-input').value.trim();
        if (val) {
            myName = val;
            localStorage.setItem('myShinobiName', val);
            updateUIState();
        }
    };

    document.getElementById('create-room-btn').onclick = async () => {
        const newRoomId = Math.floor(100 + Math.random() * 900).toString();
        await set(ref(db, `${SHINOBI_BASE_PATH}/${newRoomId}/state`), { status: "waiting", hostId: myId });
        window.location.href = `?room=${newRoomId}`;
    };

    document.getElementById('join-room-btn').onclick = () => {
        const inputId = document.getElementById('join-room-input').value.trim();
        if (inputId && inputId.length === 3) window.location.href = `?room=${inputId}`;
    };

    const enterGame = () => {
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
                
                // SVGマップ構築（未構築の場合のみ）
                if (Object.keys(shinobiSvgMap).length === 0) {
                    document.getElementById('status-msg').innerText = "暗号を生成中...";
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
    };

    updateUIState();
});

async function setupNewGame() {
    const startBtn = document.getElementById('start-btn');
    startBtn.innerText = "生成中...";
    startBtn.disabled = true;
    try {
        const hen = shuffle([...HEN_CANDIDATES]).slice(0, 7);
        const tsu = shuffle([...TSUKURI_CANDIDATES]).slice(0, 7);
        const answer = shuffle([...QUESTION_SENTENCES])[0];
        await set(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), {
            henChars: hen, tsukuriChars: tsu, answer: answer,
            status: "playing", hostId: currentGameState.hostId, gameVotes: {} 
        });
    } catch (e) { console.error(e); } finally {
        startBtn.innerText = "新しい暗号を生成（ホストのみ）";
        startBtn.disabled = false;
    }
}

async function buildShinobiMap(hens, tsus) {
    shinobiSvgMap = {};
    let kanaIdx = 0;
    console.log("忍び文字を合成中...");
    for (let h of hens) {
        for (let t of tsus) {
            if (kanaIdx < KANA_LIST.length) {
                const char = KANA_LIST[kanaIdx];
                const svg = await createCombinedSVG(h, t);
                shinobiSvgMap[char] = svg;
                kanaIdx++;
            }
        }
    }
    console.log("忍び文字の合成が完了しました。");
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
                const char = KANA_LIST[kanaIdx];
                const cell = createCell(shinobiSvgMap[char], "cell");
                const input = document.createElement("input");
                input.type = "text"; input.className = "memo-input"; input.maxLength = 1;
                const memoKey = `shinobi_memo_${roomId}_${kanaIdx}`;
                input.value = localStorage.getItem(memoKey) || "";
                input.oninput = () => localStorage.setItem(memoKey, input.value);
                cell.appendChild(input);
                table.appendChild(cell);
                kanaIdx++;
            } else { table.appendChild(createCell("", "cell")); }
        });
    });
}

function createCell(content, className) {
    const div = document.createElement("div");
    div.className = className;
    if (content && content.startsWith("<svg")) div.innerHTML = content;
    else div.innerText = content || "";
    return div;
}

document.getElementById('submit-btn').onclick = () => {
    const input = document.getElementById('answer-input');
    const guess = input.value.trim().replace(/\s+/g, "");
    if (!guess) return;
    if (guess === currentGameState.answer.replace(/\s+/g, "")) {
        update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), { status: "finished", winner: myName });
        const scoreRef = ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores/${myId}`);
        onValue(scoreRef, (s) => {
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

document.getElementById('exit-room-btn').onclick = () => window.location.href = 'index.html';
document.getElementById('start-btn').onclick = setupNewGame;

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]; 
    }
    return array;
}
