import { db, ref, set, onValue, update, get } from '../../js/firebase-config.js';
import { wordList } from './words.js'; // ② 別ファイルから読み込み

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myKanjiName') || "名無しさん";

window.addEventListener('DOMContentLoaded', () => {
    if (!roomId) {
        document.getElementById('lobby-ui').classList.remove('hidden');
        document.getElementById('game-ui').classList.add('hidden');
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
            const newRoomId = Math.floor(100 + Math.random() * 900).toString();
            await set(ref(db, `rooms/kanji-quiz/${newRoomId}/state`), {
                status: "waiting",
                hostId: myId,
                currentIndex: 0,
                gameId: Date.now() // ① 状態リセット判定用
            });
            window.location.href = `?room=${newRoomId}`;
        };

        document.getElementById('join-room-btn').onclick = () => {
            const inputId = document.getElementById('join-room-input').value.trim();
            if (inputId) window.location.href = `?room=${inputId}`;
        };
    } 
    else {
        document.getElementById('lobby-ui').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('display-room-id').innerText = roomId;
        document.getElementById('display-my-name').innerText = myName;

        set(ref(db, `rooms/kanji-quiz/${roomId}/players/${myId}`), myName);

        let isHost = false;
        let currentWord = "";
        let shuffledStrokes = [];
        let lastRenderedIndex = -1;
        let nextStepTimer = null;
        let playerCount = 0;
        let lastGameId = 0; // ① 描画リセット用

        // ④ 参加者と勝ち数の表示
        onValue(ref(db, `rooms/kanji-quiz/${roomId}`), (snapshot) => {
            const roomData = snapshot.val() || {};
            const players = roomData.players || {};
            const scores = roomData.scores || {};
            playerCount = Object.keys(players).length;
            
            const listHtml = Object.entries(players).map(([pid, name]) => {
                const win = scores[pid] || 0;
                return `<span class="player-tag">${name}<span class="win-count">${win}</span></span>`;
            }).join('');
            document.getElementById('player-list').innerHTML = listHtml;
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
                lastGuess: { user: "", userId: "", text: "", correct: false },
                strokeVotes: {},
                gameVotes: {},
                gameId: Date.now() // ① 変更を通知
            });
        }

        onValue(ref(db, `rooms/kanji-quiz/${roomId}/state`), (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            // ① 文字数に関わらず、新しいゲームIDになったら描画をリセット
            if (data.gameId !== lastGameId) {
                document.getElementById('kanji-stage').innerHTML = '';
                lastRenderedIndex = -1;
                lastGameId = data.gameId;
            }

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
            } 
            else if (data.status === "playing") {
                startBtn.classList.add('hidden');
                playUi.classList.remove('hidden');
                resultUi.classList.add('hidden');
                
                const isCorrect = data.lastGuess?.correct;
                updateCanvas(data, isCorrect);

                const sVotes = data.strokeVotes ? Object.keys(data.strokeVotes).length : 0;
                document.getElementById('stroke-vote-count').innerText = `${sVotes}/${playerCount}`;
                
                if (isHost && !isCorrect) {
                    if (sVotes >= playerCount && playerCount > 0) {
                        advanceStroke(data.currentIndex);
                    } else {
                        startStepTimer(data.currentIndex);
                    }
                }
            }

            if (data.lastGuess && data.lastGuess.user) {
                document.getElementById('announcement').innerText = `${data.lastGuess.user}：${data.lastGuess.text}`;
                if (data.lastGuess.correct) {
                    if(nextStepTimer) { clearTimeout(nextStepTimer); nextStepTimer = null; }
                    showResult(data.lastGuess.user);
                }
            }

            const gVotes = data.gameVotes ? Object.keys(data.gameVotes).length : 0;
            document.getElementById('game-vote-count').innerText = `${gVotes}/${playerCount}`;
            if (isHost && gVotes >= playerCount && playerCount > 0) {
                update(ref(db, `rooms/kanji-quiz/${roomId}/state`), { gameVotes: {} });
                setupNewGame();
            }
        });

        function updateCanvas(data, showAll = false) {
            const stage = document.getElementById('kanji-stage');
            // ① 強制クリア条件を gameId に依存させたため、ここは構造維持のみ
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

            const limit = showAll ? shuffledStrokes.length - 1 : data.currentIndex;
            for (let i = lastRenderedIndex + 1; i <= limit; i++) {
                const stroke = shuffledStrokes[i];
                if (!stroke) continue;
                const svg = document.getElementById(`svg-${stroke.charIndex}`);
                if(!svg) continue;
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", stroke.d);
                if (showAll) path.style.stroke = "#ff0000";
                svg.appendChild(path);
                lastRenderedIndex = i;
            }
        }

        function advanceStroke(idx) {
            if (idx < shuffledStrokes.length - 1) {
                update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                    currentIndex: idx + 1,
                    strokeVotes: {} 
                });
            }
        }

        function startStepTimer(idx) {
            if (nextStepTimer) return;
            nextStepTimer = setTimeout(() => {
                nextStepTimer = null;
                advanceStroke(idx);
            }, 5000);
        }

        document.getElementById('submit-btn').onclick = async () => {
            const input = document.getElementById('answer-input');
            const guess = input.value.trim();
            if (!guess) return;
            const isCorrect = (guess === currentWord);
            
            // ④ 正解した場合、勝ち数をインクリメント
            if (isCorrect) {
                const scoreRef = ref(db, `rooms/kanji-quiz/${roomId}/scores/${myId}`);
                const snap = await get(scoreRef);
                const currentScore = snap.val() || 0;
                set(scoreRef, currentScore + 1);
            }

            update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                lastGuess: { user: myName, userId: myId, text: guess, correct: isCorrect }
            });
            input.value = "";
        };

        document.getElementById('stroke-vote-btn').onclick = () => {
            update(ref(db, `rooms/kanji-quiz/${roomId}/state/strokeVotes`), { [myId]: true });
        };

        document.getElementById('next-game-btn').onclick = () => {
            update(ref(db, `rooms/kanji-quiz/${roomId}/state/gameVotes`), { [myId]: true });
        };

        function showResult(winner) {
            document.getElementById('play-ui').classList.add('hidden');
            document.getElementById('result-ui').classList.remove('hidden');
            document.getElementById('winner-msg').innerText = `正解！勝者: ${winner}`;
            document.getElementById('correct-word-display').innerText = currentWord;
        }

        document.getElementById('start-btn').onclick = setupNewGame;
    }
});
