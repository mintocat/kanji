import { db, ref, set, get, onValue, update } from '../../js/firebase-config.js';

// URLからルームIDを取得
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

// IDと名前の管理
let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myKanjiName') || "名無しさん";

// =========================================================
// 1. ロビー画面の処理 (roomIdがない場合)
// =========================================================
if (!roomId) {
    document.getElementById('lobby-ui').classList.remove('hidden');
    document.getElementById('game-ui').classList.add('hidden');
    document.getElementById('lobby-my-name').innerText = myName;

    // 名前設定
    document.getElementById('save-name-btn').onclick = () => {
        const val = document.getElementById('name-input').value.trim();
        if (val) {
            myName = val;
            localStorage.setItem('myKanjiName', val);
            document.getElementById('lobby-my-name').innerText = val;
            alert("名前を設定しました！");
        }
    };

    // ルーム作成（ランダムなIDを生成して遷移）
    document.getElementById('create-room-btn').onclick = async () => {
        const newRoomId = Math.random().toString(36).substring(2, 8); // 6文字のランダムID
        const roomRef = ref(db, `rooms/kanji-quiz/${newRoomId}/state`);
        
        // 自分がホストとして初期データをセット
        await set(roomRef, {
            status: "waiting",
            hostId: myId,
            createdAt: Date.now()
        });
        
        // パラメータを付けて再読み込み（ゲーム画面へ）
        window.location.href = `?room=${newRoomId}`;
    };

    // ルーム入室
    document.getElementById('join-room-btn').onclick = () => {
        const inputId = document.getElementById('join-room-input').value.trim();
        if (inputId) {
            window.location.href = `?room=${inputId}`;
        } else {
            alert("ルームIDを入力してください");
        }
    };
} 
// =========================================================
// 2. ゲーム画面の処理 (roomIdがある場合)
// =========================================================
else {
    document.getElementById('lobby-ui').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');

    document.getElementById('display-room-id').innerText = roomId;
    document.getElementById('display-my-name').innerText = myName;

    let isHost = false;
    let currentWord = "";
    let shuffledStrokes = [];
    let lastRenderedIndex = -1;
    let nextStepTimer = null;

    // --- 漢字データの取得 ---
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
        } catch (e) { return []; }
    }

    async function setupNewGame() {
        const wordList = ["漢字", "学校", "太陽", "新幹線", "一期一会", "弱肉強食", "図書室", "不動産", "公立高校"];
        const word = wordList[Math.floor(Math.random() * wordList.length)];
        let allStrokes = [];
        for (let i = 0; i < word.length; i++) {
            const strokes = await getStrokes(word[i], i);
            allStrokes = allStrokes.concat(strokes);
        }
        allStrokes.sort(() => Math.random() - 0.5);

        await set(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
            word: word,
            strokes: allStrokes,
            currentIndex: 0,
            status: "playing",
            hostId: myId,
            lastGuess: { user: "", text: "", correct: false },
            playersGuessed: {} 
        });
    }

    // --- メイン監視ループ ---
    onValue(ref(db, `rooms/kanji-quiz/${roomId}/state`), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        isHost = (data.hostId === myId);
        currentWord = data.word;
        shuffledStrokes = data.strokes;

        const startBtn = document.getElementById('start-btn');
        const playUi = document.getElementById('play-ui');
        const resultUi = document.getElementById('result-ui');

        if (data.status === "waiting") {
            startBtn.classList.toggle('hidden', !isHost);
            playUi.classList.add('hidden');
            resultUi.classList.add('hidden');
            document.getElementById('announcement').innerText = isHost ? "参加者が揃ったら開始！" : "ホストを待機中...";
        } 
        else if (data.status === "playing") {
            startBtn.classList.add('hidden');
            playUi.classList.remove('hidden');
            resultUi.classList.add('hidden');
            updateCanvas(data);
        }

        if (data.lastGuess && data.lastGuess.user) {
            document.getElementById('announcement').innerText = `${data.lastGuess.user}さんの解答: ${data.lastGuess.text}`;
            if (data.lastGuess.correct) {
                setTimeout(() => showResult(data.lastGuess.user), 1000);
            }
        }

        // 自動進行ロジック
        if (isHost && data.status === "playing" && !data.lastGuess.correct) {
            manageTimer(data);
        }
    });

    function updateCanvas(data) {
        const stage = document.getElementById('kanji-stage');
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

    function manageTimer(data) {
        const guessedCount = data.playersGuessed ? Object.keys(data.playersGuessed).length : 0;
        if (!nextStepTimer && guessedCount > 0) {
            nextStepTimer = setTimeout(() => {
                update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                    currentIndex: data.currentIndex + 1,
                    playersGuessed: {}
                });
                nextStepTimer = null;
                document.getElementById('wait-msg').classList.add('hidden');
            }, 5000);
        }
    }

    document.getElementById('submit-btn').onclick = () => {
        const input = document.getElementById('answer-input');
        const guess = input.value.trim();
        if (!guess) return;

        update(ref(db, `rooms/kanji-quiz/${roomId}/state/playersGuessed/${myId}`), true);
        update(ref(db, `rooms/kanji-quiz/${roomId}/state/lastGuess`), {
            user: myName,
            text: guess,
            correct: (guess === currentWord)
        });
        
        input.value = "";
        document.getElementById('wait-msg').classList.remove('hidden');
    };

    function showResult(winner) {
        document.getElementById('play-ui').classList.add('hidden');
        document.getElementById('result-ui').classList.remove('hidden');
        document.getElementById('winner-msg').innerText = `正解！勝者: ${winner}`;
        document.getElementById('correct-word-display').innerText = `${currentWord}`;
    }

    document.getElementById('start-btn').onclick = setupNewGame;
    document.getElementById('next-game-btn').onclick = setupNewGame;
}
