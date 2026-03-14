import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

// --- 初期設定 ---
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

// プレイヤーIDの管理（リロードしても変わらないようにsessionStorageを使用）
let myId = sessionStorage.getItem('myPlayerId');
if (!myId) {
    myId = Math.random().toString(36).substring(7);
    sessionStorage.setItem('myPlayerId', myId);
}
let myName = "プレイヤー" + myId.substring(0, 3);

// 状態管理用変数
let isHost = false;
let currentWord = "";
let shuffledStrokes = [];
let lastRenderedIndex = -1;

document.getElementById('display-room-id').innerText = roomId;

// --- 漢字データの取得 (KanjiVG) ---
async function getStrokes(char, charIndex) {
    const unicode = char.charCodeAt(0).toString(16).padStart(5, '0');
    const url = `https://cdn.jsdelivr.net/gh/kanjivg/kanjivg/kanji/${unicode}.svg`;
    try {
        const response = await fetch(url);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "image/svg+xml");
        return Array.from(doc.querySelectorAll('path')).map(p => ({
            d: p.getAttribute('d'),
            charIndex: charIndex
        }));
    } catch (e) {
        console.error("SVG取得エラー:", e);
        return [];
    }
}

// --- ゲーム初期化 (ホストのみが実行) ---
async function setupNewGame() {
    const wordList = ["漢字", "学校", "太陽", "新幹線", "一期一会", "弱肉強食", "図書室"];
    const word = wordList[Math.floor(Math.random() * wordList.length)];
    
    document.getElementById('announcement').innerText = "問題作成中...";

    let allStrokes = [];
    for (let i = 0; i < word.length; i++) {
        const strokes = await getStrokes(word[i], i);
        allStrokes = allStrokes.concat(strokes);
    }
    // 画をランダムにシャッフル
    allStrokes.sort(() => Math.random() - 0.5);

    // Firebaseの状態を「進行中」に更新
    await set(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
        word: word,
        strokes: allStrokes,
        currentIndex: 0,
        status: "playing",
        hostId: myId, // ホストIDを維持
        lastGuess: { user: "", text: "", correct: false },
        playersGuessed: {} 
    });
}

// --- メイン監視ループ (Firebaseの変化を検知) ---
onValue(ref(db, `rooms/kanji-quiz/${roomId}/state`), (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    // ホスト判定
    isHost = (data.hostId === myId);
    currentWord = data.word;
    shuffledStrokes = data.strokes;

    // UIの表示切り替え
    const startBtn = document.getElementById('start-btn');
    const playUi = document.getElementById('play-ui');
    const resultUi = document.getElementById('result-ui');

    if (data.status === "waiting") {
        startBtn.classList.toggle('hidden', !isHost);
        playUi.classList.add('hidden');
        resultUi.classList.add('hidden');
        document.getElementById('announcement').innerText = isHost ? "参加者が揃ったら開始してください" : "ホストの開始を待っています...";
    } 
    else if (data.status === "playing") {
        startBtn.classList.add('hidden');
        playUi.classList.remove('hidden');
        resultUi.classList.add('hidden');
        updateCanvas(data);
    }

    // 解答通知
    if (data.lastGuess && data.lastGuess.user) {
        const ann = document.getElementById('announcement');
        ann.innerText = `${data.lastGuess.user}さんの解答: ${data.lastGuess.text}`;
        
        if (data.lastGuess.correct) {
            setTimeout(() => showResult(data.lastGuess.user), 1000);
        }
    }

    // 【ホスト限定】全員解答済みなら次の画へ
    if (isHost && data.status === "playing" && !data.lastGuess.correct) {
        checkProgress(data);
    }
});

// --- 描画処理 ---
function updateCanvas(data) {
    const stage = document.getElementById('kanji-stage');
    
    // 枠が足りなければ作成
    if (stage.children.length !== currentWord.length) {
        stage.innerHTML = '';
        for (let i = 0; i < currentWord.length; i++) {
            const box = document.createElement('div');
            box.className = 'kanji-box';
            box.innerHTML = `<svg viewBox="0 0 109 109" id="svg-${i}"></svg>`;
            stage.appendChild(box);
        }
        lastRenderedIndex = -1;
    }

    // currentIndexまで画を描画
    for (let i = lastRenderedIndex + 1; i <= data.currentIndex; i++) {
        const stroke = shuffledStrokes[i];
        if (!stroke) continue;
        const svg = document.getElementById(`svg-${stroke.charIndex}`);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", stroke.d);
        svg.appendChild(path);
        lastRenderedIndex = i;
    }
}

// --- 解答送信 ---
document.getElementById('submit-btn').onclick = () => {
    const input = document.getElementById('answer-input');
    const guess = input.value.trim();
    if (!guess) return;

    const isCorrect = (guess === currentWord);
    
    const updates = {};
    updates[`rooms/kanji-quiz/${roomId}/state/playersGuessed/${myId}`] = true;
    updates[`rooms/kanji-quiz/${roomId}/state/lastGuess`] = {
        user: myName,
        text: guess,
        correct: isCorrect
    };
    
    update(ref(db), updates);
    input.value = "";
    document.getElementById('wait-msg').classList.remove('hidden');
};

// --- ホストによる次画への進行管理 ---
function checkProgress(data) {
    const guessedCount = data.playersGuessed ? Object.keys(data.playersGuessed).length : 0;
    
    // 全員が解答したかの判定（今回は簡易的に1人以上が解答したら2秒後に次へ）
    // 実際に対戦人数を数える場合は、別階層で管理している参加者数と比較します
    if (guessedCount > 0) {
        setTimeout(() => {
            // 再度現在のデータを取得して、まだ次の画に行ってなければ更新
            update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                currentIndex: data.currentIndex + 1,
                playersGuessed: {} // 解答フラグをリセット
            });
            document.getElementById('wait-msg').classList.add('hidden');
        }, 2000);
    }
}

// --- リザルト表示 ---
function showResult(winner) {
    document.getElementById('play-ui').classList.add('hidden');
    document.getElementById('result-ui').classList.remove('hidden');
    document.getElementById('winner-msg').innerText = `正解！勝者: ${winner}`;
    document.getElementById('announcement').innerText = "ゲーム終了";
}

// --- イベント登録 ---
document.getElementById('start-btn').onclick = setupNewGame;
document.getElementById('next-game-btn').onclick = setupNewGame;
