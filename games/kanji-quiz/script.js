import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myKanjiName') || "名無しさん";

window.addEventListener('DOMContentLoaded', () => {
    const lobbyUi = document.getElementById('lobby-ui');
    const gameUi = document.getElementById('game-ui');

    if (!roomId) {
        // --- ロビー処理 ---
        lobbyUi.classList.remove('hidden');
        gameUi.classList.add('hidden');
        document.getElementById('lobby-my-name').innerText = myName;

        document.getElementById('save-name-btn').onclick = () => {
            const val = document.getElementById('name-input').value.trim();
            if (val) {
                myName = val;
                localStorage.setItem('myKanjiName', val);
                document.getElementById('lobby-my-name').innerText = val;
                alert("名前を設定しました！");
            }
        };

        document.getElementById('create-room-btn').onclick = async () => {
            const newRoomId = Math.random().toString(36).substring(2, 8);
            // 部屋の初期状態を作成
            await set(ref(db, `rooms/kanji-quiz/${newRoomId}/state`), {
                status: "waiting",
                hostId: myId,
                currentIndex: 0
            });
            window.location.href = `?room=${newRoomId}`;
        };

        document.getElementById('join-room-btn').onclick = () => {
            const inputId = document.getElementById('join-room-input').value.trim();
            if (inputId) window.location.href = `?room=${inputId}`;
        };
    } 
    else {
        // --- ゲーム画面処理 ---
        lobbyUi.classList.add('hidden');
        gameUi.classList.remove('hidden');
        document.getElementById('display-room-id').innerText = roomId;
        document.getElementById('display-my-name').innerText = myName;

        // 【修正】参加者登録を確実に実行
        set(ref(db, `rooms/kanji-quiz/${roomId}/players/${myId}`), myName);

        let isHost = false;
        let currentWord = "";
        let shuffledStrokes = [];
        let lastRenderedIndex = -1;
        let nextStepTimer = null;

        // 参加者リストの監視
        onValue(ref(db, `rooms/kanji-quiz/${roomId}/players`), (snapshot) => {
            const players = snapshot.val();
            const listEl = document.getElementById('player-list');
            if (!players) {
                listEl.innerText = "待機中...";
                return;
            }
            const listHtml = Object.values(players).map(name => `<span class="player-tag">${name}</span>`).join('');
            listEl.innerHTML = listHtml;
        });

        async function getStrokes(char, charIndex) {
            const unicode = char.charCodeAt(0).toString(16).padStart(5, '0');
            const url = `https://cdn.jsdelivr.net/gh/kanjivg/kanjivg/kanji/${unicode}.svg`;
            try {
                const response = await fetch(url);
                const text = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, "image/svg+xml");
                return Array.from(doc.querySelectorAll('path')).map(p => ({ d: p.getAttribute('d'), charIndex: charIndex }));
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

            // ゲーム開始時のデータを一括セット
            await update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                word: word,
                strokes: allStrokes,
                currentIndex: 0,
                status: "playing",
                hostId: myId,
                lastGuess: { user: "", text: "", correct: false }
            });
        }

        // メイン監視ループ
        onValue(ref(db, `rooms/kanji-quiz/${roomId}/state`), (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            isHost = (data.hostId === myId);
            currentWord = data.word || "";
            shuffledStrokes = data.strokes || [];

            const startBtn = document.getElementById('start-btn');
            const playUi = document.getElementById('play-ui');
            const resultUi = document.getElementById('result-ui');

            if (data.status === "waiting") {
                startBtn.classList.toggle('hidden', !isHost);
                playUi.classList.add('hidden');
                resultUi.classList.add('hidden');
                document.getElementById('announcement').innerText = isHost ? "全員揃ったら開始ボタンを押してください" : "ホストが開始するのを待っています...";
            } 
            else if (data.status === "playing") {
                startBtn.classList.add('hidden');
                playUi.classList.remove('hidden');
                resultUi.classList.add('hidden');
                updateCanvas(data);
                
                // 【重要】ホストのみ、5秒タイマーを管理
                if (isHost && !data.lastGuess?.correct) {
                    startStepTimer(data.currentIndex);
                }
            }

            if (data.lastGuess && data.lastGuess.user) {
                document.getElementById('announcement').innerText = `${data.lastGuess.user}：${data.lastGuess.text}`;
                if (data.lastGuess.correct) {
                    clearTimeout(nextStepTimer);
                    nextStepTimer = null;
                    showResult(data.lastGuess.user);
                }
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
                if(!svg) continue;
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", stroke.d);
                svg.appendChild(path);
                lastRenderedIndex = i;
            }
        }

        // --- ホスト用：進行タイマーの改善 ---
        function startStepTimer(idx) {
            if (nextStepTimer) return; // 既に動いていれば二重に作らない

            nextStepTimer = setTimeout(() => {
                nextStepTimer = null; // 実行時にリセット
                if (idx < shuffledStrokes.length - 1) {
                    update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                        currentIndex: idx + 1
                    });
                }
            }, 5000);
        }

        // 解答送信
        document.getElementById('submit-btn').onclick = () => {
            const input = document.getElementById('answer-input');
            const guess = input.value.trim();
            if (!guess) return;

            const isCorrect = (guess === currentWord);
            
            // lastGuessを一括で更新（反応を確実にする）
            update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                lastGuess: {
                    user: myName,
                    text: guess,
                    correct: isCorrect
                }
            });
            
            input.value = "";
            document.getElementById('wait-msg').classList.remove('hidden');
            setTimeout(() => document.getElementById('wait-msg').classList.add('hidden'), 2000);
        };

        function showResult(winner) {
            document.getElementById('play-ui').classList.add('hidden');
            document.getElementById('result-ui').classList.remove('hidden');
            document.getElementById('winner-msg').innerText = `正解！勝者: ${winner}`;
            document.getElementById('correct-word-display').innerText = currentWord;
        }

        document.getElementById('start-btn').onclick = setupNewGame;
        document.getElementById('next-game-btn').onclick = setupNewGame;
    }
});
