import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const myId = Math.random().toString(36).substring(7); // 簡易プレイヤーID
let myName = "プレイヤー" + myId.substring(0, 3);

// 状態保持
let currentWord = "";
let shuffledStrokes = [];
let isHost = false;

document.getElementById('display-room-id').innerText = roomId;

// --- 漢字データの取得 ---
async function getStrokes(char, charIndex) {
    const unicode = char.charCodeAt(0).toString(16).padStart(5, '0');
    const url = `https://cdn.jsdelivr.net/gh/kanjivg/kanjivg/kanji/${unicode}.svg`;
    const response = await fetch(url);
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "image/svg+xml");
    return Array.from(doc.querySelectorAll('path')).map(p => ({
        d: p.getAttribute('d'),
        charIndex: charIndex
    }));
}

// --- ゲーム初期化（ホストが実行） ---
async function setupNewGame() {
    const wordList = ["漢字", "学校", "太陽", "新幹線", "四面楚歌"];
    const word = wordList[Math.floor(Math.random() * wordList.length)];
    
    let allStrokes = [];
    for (let i = 0; i < word.length; i++) {
        const strokes = await getStrokes(word[i], i);
        allStrokes = allStrokes.concat(strokes);
    }
    // 画をシャッフル
    allStrokes.sort(() => Math.random() - 0.5);

    // Firebaseをリセット
    set(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
        word: word,
        strokes: allStrokes,
        currentIndex: 0,
        status: "playing",
        lastGuess: { user: "", text: "", correct: false },
        playersGuessed: {} // 解答済みプレイヤーリスト
    });
}

// --- メイン監視ループ ---
onValue(ref(db, `rooms/kanji-quiz/${roomId}/state`), (snapshot) => {
    const data = snapshot.val();
    if (!data) {
        isHost = true; // 最初にアクセスした人をホストとする
        return;
    }

    currentWord = data.word;
    shuffledStrokes = data.strokes;
    const idx = data.currentIndex;

    // 1. 枠の生成（文字数分）
    const stage = document.getElementById('kanji-stage');
    if (stage.children.length !== currentWord.length) {
        stage.innerHTML = '';
        for (let i = 0; i < currentWord.length; i++) {
            const box = document.createElement('div');
            box.className = 'kanji-box';
            box.innerHTML = `<svg viewBox="0 0 109 109" id="svg-${i}"></svg>`;
            stage.appendChild(box);
        }
    }

    // 2. 画の描画
    for (let i = 0; i <= idx; i++) {
        const stroke = shuffledStrokes[i];
        if (!stroke) continue;
        const svg = document.getElementById(`svg-${stroke.charIndex}`);
        if (!svg.querySelector(`path[d="${stroke.d}"]`)) {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", stroke.d);
            svg.appendChild(path);
        }
    }

    // 3. 解答通知
    if (data.lastGuess && data.lastGuess.user) {
        const ann = document.getElementById('announcement');
        ann.innerText = `${data.lastGuess.user}さんの解答: ${data.lastGuess.text}`;
        // 正解ならリザルトへ
        if (data.lastGuess.correct) {
            setTimeout(() => {
                showResult(data.lastGuess.user);
            }, 1500);
        }
    }

    // 4. 全員解答済みかチェック（ホストのみが進行管理）
    if (isHost && data.status === "playing") {
        checkAllPlayersGuessed(data);
    }

    // UIの切り替え
    document.getElementById('start-btn').classList.toggle('hidden', data.status !== "waiting");
    document.getElementById('play-ui').classList.toggle('hidden', data.status !== "playing");
});

// --- 解答送信 ---
document.getElementById('submit-btn').onclick = () => {
    const input = document.getElementById('answer-input');
    const guess = input.value.trim();
    if (!guess) return;

    const isCorrect = (guess === currentWord);
    
    // 自分の解答を記録し、通知を送る
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

// --- ホストによる進行管理 ---
function checkAllPlayersGuessed(data) {
    const players = data.playersGuessed ? Object.keys(data.playersGuessed).length : 0;
    // 注：本来は接続人数と比較すべきですが、今回は「誰かが答えたら次へ」を避けるため
    // 簡易的に「1人以上が答えた状態で、全員が解答フラグを持つか」を判定
    // (デモ用：実際はRoomの参加者リストと比較してください)
    
    // 全員の解答が揃ったら次へ（今回は1人デバッグも考慮し、特定条件で次へ）
    if (players > 0 && !data.lastGuess.correct) {
        // 全員が解答したというフラグのリセットとインデックス増加
        setTimeout(() => {
            update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                currentIndex: data.currentIndex + 1,
                playersGuessed: {} // リセット
            });
        }, 2000);
    }
}

function showResult(winner) {
    document.getElementById('play-ui').classList.add('hidden');
    document.getElementById('result-ui').classList.remove('hidden');
    document.getElementById('winner-msg').innerText = `正解！勝者: ${winner}`;
}

document.getElementById('start-btn').onclick = setupNewGame;
document.getElementById('next-game-btn').onclick = setupNewGame;
