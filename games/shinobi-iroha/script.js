import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

// --- ゲーム設定 ---
const KANA_LIST = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやいゆえよらりるれろわをんー".split("");
const SHINOBI_BASE_PATH = "rooms/shinobi-iroha";

// 忍び文字に使う漢字候補（偏と旁として自然に見えやすいもの）
const HEN_CANDIDATES = ["人", "木", "水", "火", "土", "金", "身", "口", "日", "月"]; 
const TSUKURI_CANDIDATES = ["口", "力", "女", "子", "寸", "心", "立", "刀", "又", "巴"];

// 出題用の短い文章リスト（解読しがいのある長さ）
const QUESTION_SENTENCES = [
    "にんじゃのあんごうをときあかせ",
    "きょうはとてもいい天気ですね",
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
let shinobiSvgMap = {}; // 暗号描画用

// --- 音声演出（簡易） ---
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

// --- 漢字SVG取得 & 合成エンジン ---
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
    // 偏（左側に0.5倍圧縮）
    combined += `<g transform="scale(0.5, 1) translate(0, 0)">`;
    henPaths.forEach(d => combined += `<path d="${d}" fill="none" stroke="black" stroke-width="5" stroke-linecap="round"/>`);
    combined += `</g>`;
    // 旁（右側に0.5倍圧縮して50ずらす）
    combined += `<g transform="scale(0.5, 1) translate(100, 0)">`;
    tsukuriPaths.forEach(d => combined += `<path d="${d}" fill="none" stroke="black" stroke-width="5" stroke-linecap="round"/>`);
    combined += `</g>`;
    combined += `</svg>`;
    return combined;
}

// --- メインロジック ---
window.addEventListener('DOMContentLoaded', () => {
    // --- ロビー画面の処理 ---
    if (!roomId) {
        document.getElementById('lobby-ui').classList.remove('hidden');
        document.getElementById('game-ui').classList.add('hidden');
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
        // 名前が既に設定されているなら、最初からコントロールを表示
        if (localStorage.getItem('myShinobiName')) {
            document.getElementById('room-controls').classList.remove('hidden');
            document.getElementById('name-setup').classList.add('hidden');
        }

        document.getElementById('create-room-btn').onclick = async () => {
            const newRoomId = Math.floor(100 + Math.random() * 900).toString(); // 3桁
            await set(ref(db, `${SHINOBI_BASE_PATH}/${newRoomId}/state`), {
                status: "waiting", hostId: myId, createdAt: Date.now()
            });
            window.location.href = `?room=${newRoomId}`;
        };

        document.getElementById('join-room-btn').onclick = () => {
            const inputId = document.getElementById('join-room-input').value.trim();
            if (inputId && inputId.length === 3) window.location.href = `?room=${inputId}`;
        };
    } 
    // --- ゲーム画面の処理 ---
    else {
        document.getElementById('lobby-ui').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('display-room-id').innerText = roomId;
        document.getElementById('display-my-name').innerText = myName;

        // 参加者として登録
        set(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/players/${myId}`), myName);

        // プレイヤー一覧、スコア、ゲーム状態の監視
        onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/players`), (snapshot) => {
            roomPlayers = snapshot.val() || {};
            const listHtml = Object.values(roomPlayers).map(name => `<span class="player-tag">${name}</span>`).join('');
            document.getElementById('player-list').innerHTML = listHtml;
        });

        onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores`), (snapshot) => {
            const scores = snapshot.val() || {};
            const sorted = Object.entries(scores).sort((a,b) => b[1] - a[1]);
            document.getElementById('score-list').innerHTML = sorted.map(([pId, s]) => 
                `<div class="score-item"><span>${roomPlayers[pId] || '...'}</span><span>${s}回</span></div>`
            ).join('');
        });

        // メインの状態監視
        onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), async (snapshot) => {
            const data = snapshot.val();
            if (!data) return;
            currentGameState = data;
            const isHost = (data.hostId === myId);

            if (data.status === "waiting") {
                document.getElementById('start-btn').classList.toggle('hidden', !isHost);
                document.getElementById('play-screen').classList.add('hidden');
                document.getElementById('status-msg').innerText = "ホストの開始を待っています...";
            } 
            else if (data.status === "playing") {
                document.getElementById('start-btn').classList.add('hidden');
                document.getElementById('play-screen').classList.remove('hidden');
                document.getElementById('result-overlay').classList.add('hidden');
                
                // 初回のみ表と暗号を描画
                if (Object.keys(shinobiSvgMap).length === 0) {
                    await buildShinobiMap(data.henChars, data.tsukuriChars);
                    renderDecodeTable(data.henChars, data.tsukuriChars);
                    renderCipherText(data.answer);
                    playSound('start');
                }
                document.getElementById('status-msg').innerText = "解読せよ！";
            }
            else if (data.status === "finished") {
                showResult(data);
            }

            // 次のゲームへの投票監視
            const gVotes = data.gameVotes ? Object.keys(data.gameVotes).length : 0;
            const pCount = Object.keys(roomPlayers).length;
            document.getElementById('game-vote-count').innerText = `${gVotes}/${pCount}`;
            document.getElementById('result-vote-msg').innerText = isHost ? "全員揃ったら開始" : "ホストの開始待ち";
            if (isHost && gVotes >= pCount && pCount > 0 && data.status === "finished") {
                setupNewGame();
            }
        });
    }
});

// --- ゲーム開始処理（ホスト） ---
async function setupNewGame() {
    document.getElementById('start-btn').innerText = "生成中...";
    document.getElementById('start-btn').disabled = true;

    // 1. 漢字ペアをランダム選抜 (7偏 x 7旁 = 49マス)
    const hen = shuffle([...HEN_CANDIDATES]).slice(0, 7);
    const tsu = shuffle([...TSUKURI_CANDIDATES]).slice(0, 7);

    // 2. お題の文章を選抜（答え）
    const answer = shuffle([...QUESTION_SENTENCES])[0];

    // 3. マップをクリアして開始
    shinobiSvgMap = {}; 
    const isHost = currentGameState?.hostId === myId;

    // Firebaseを更新してゲーム開始
    await set(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), {
        henChars: hen,
        tsukuriChars: tsu,
        answer: answer,
        status: "playing",
        hostId: myId, // ホストIDを維持
        gameVotes: {} // 投票をリセット
    });

    document.getElementById('start-btn').innerText = "新しい暗号を生成（ホストのみ）";
    document.getElementById('start-btn').disabled = false;
}

// --- UI描画処理 ---

// 忍び文字のSVGマップを作成（暗号文描画用）
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

// 暗号文（SVGの並び）を表示
function renderCipherText(answer) {
    const area = document.getElementById('cipher-area');
    area.innerHTML = '';
    answer.split("").forEach(char => {
        const div = document.createElement("div");
        if (char === " " || char === "　") {
            div.className = "cipher-char space"; // スペース処理
        } else {
            div.className = "cipher-char";
            div.innerHTML = shinobiSvgMap[char] || "?"; // 忍び文字に変換
        }
        area.appendChild(div);
    });
}

// 解読用メモ表（入力欄付き）を表示
function renderDecodeTable(hens, tsus) {
    const table = document.getElementById('decode-table');
    table.innerHTML = '';

    // 角の空セル
    table.appendChild(createCell("", "header-cell"));
    // 行ヘッダー（旁）
    tsus.forEach(t => table.appendChild(createCell(t, "header-cell")));

    let kanaIdx = 0;
    hens.forEach(h => {
        // 列ヘッダー（偏）
        table.appendChild(createCell(h, "header-cell")); 
        
        tsus.forEach(t => {
            if (kanaIdx < KANA_LIST.length) {
                const svg = shinobiSvgMap[KANA_LIST[kanaIdx]];
                const cell = createCell(svg, "cell");
                
                // 自分用の入力メモ欄
                const input = document.createElement("input");
                input.type = "text";
                input.className = "memo-input";
                input.maxLength = 1; // 1文字だけ
                // ローカルストレージにメモを保存（リロード対策）
                const memoKey = `shinobi_memo_${roomId}_${kanaIdx}`;
                input.value = localStorage.getItem(memoKey) || "";
                input.oninput = () => localStorage.setItem(memoKey, input.value);

                cell.appendChild(input);
                table.appendChild(cell);
                kanaIdx++;
            } else {
                // 49文字を超えた場合（通常はない）
                table.appendChild(createCell("", "cell"));
            }
        });
    });
}

function createCell(content, className) {
    const div = document.createElement("div");
    div.className = className;
    if (content.startsWith("<svg")) {
        div.innerHTML = content;
    } else {
        div.innerText = content;
    }
    return div;
}

// 解答送信
document.getElementById('submit-btn').onclick = () => {
    const input = document.getElementById('answer-input');
    const guess = input.value.trim().replace(/\s+/g, ""); // スペースを詰める
    if (!guess) return;

    // 正誤判定
    if (guess === currentGameState.answer) {
        document.getElementById('status-msg').innerText = "送信中...";
        // 正解なら勝者としてFirebaseに記録
        update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state`), {
            status: "finished",
            winner: myName,
            winnerId: myId
        });
        // スコア加算
        onValue(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores/${myId}`), (s) => {
            const curScore = s.val() || 0;
            update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/scores`), { [myId]: curScore + 1 });
        }, { onlyOnce: true });
        
        playSound('correct');
        input.value = "";
    } else {
        document.getElementById('status-msg').innerText = "違います！";
        document.getElementById('status-msg').style.color = "red";
        setTimeout(() => {
            document.getElementById('status-msg').innerText = "解読せよ！";
            document.getElementById('status-msg').style.color = "#ffae00";
        }, 1500);
    }
};

// 結果発表
function showResult(data) {
    document.getElementById('result-overlay').classList.remove('hidden');
    document.getElementById('winner-msg').innerText = `勝者：${data.winner || '不明'}`;
    document.getElementById('correct-answer').innerText = data.answer;
    shinobiSvgMap = {}; // 次のゲームのためにマップをリセット
}

// 次のゲームへの投票
document.getElementById('next-game-btn').onclick = () => {
    // メモをクリア
    for(let i=0; i<KANA_LIST.length; i++){
        localStorage.removeItem(`shinobi_memo_${roomId}_${i}`);
    }
    update(ref(db, `${SHINOBI_BASE_PATH}/${roomId}/state/gameVotes`), { [myId]: true });
};

// ホーム画面へのボタン設定
document.getElementById('start-btn').onclick = setupNewGame;

// 配列をシャッフルする関数
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[array[i]]];
    }
    return array;
}
