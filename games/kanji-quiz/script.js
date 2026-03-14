import { db, ref, set, onValue, update } from '../../js/firebase-config.js';
import { wordList } from './words.js'; // ②別ファイルから読み込み

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
        document.getElementById('lobby-ui').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('display-room-id').innerText = roomId;
        document.getElementById('display-my-name').innerText = myName;

        // 参加者登録時に勝ち数（wins）も初期化
        const myPlayerRef = ref(db, `rooms/kanji-quiz/${roomId}/players/${myId}`);
        update(myPlayerRef, { name: myName });

        let isHost = false;
        let currentWord = "";
        let shuffledStrokes = [];
        let lastRenderedIndex = -1;
        let nextStepTimer = null;
        let playerCount = 0;
        let currentWordId = ""; // ①リセットバグ修正用

        // 参加者リストと勝ち数の監視
        onValue(ref(db, `rooms/kanji-quiz/${roomId}/players`), (snapshot) => {
            const players = snapshot.val() || {};
            playerCount = Object.keys(players).length;
            const listHtml = Object.entries(players).map(([id, p]) => {
                const winCount = p.wins || 0; // ④勝ち数表示
                return `<span class="player-tag">${p.name}<span class="win-count">${winCount}</span></span>`;
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
            const wordId = Math.random().toString(36).substring(7); // ①リセットバグ修正用ID
            let allStrokes = [];
            for (let i = 0; i < word.length; i++) {
                const strokes = await getStrokes(word[i], i);
                allStrokes = allStrokes.concat(strokes);
            }
            allStrokes.sort(() => Math.random() - 0.5);

            await set(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                word: word,
                wordId: wordId,
                strokes: allStrokes,
                currentIndex: 0,
                status: "playing",
                hostId: myId,
                lastGuess: { user: "", userId: "", text: "", correct: false },
                strokeVotes: {},
                gameVotes: {}
            });
        }

        onValue(ref(db, `rooms/kanji-quiz/${roomId}/state`), (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            isHost = (data.hostId === myId);
            
            // ①文字数が同じでもリセットをかける
            if (currentWordId !== data.wordId) {
                currentWordId = data.wordId;
                document.getElementById('kanji-stage').innerHTML = '';
                lastRenderedIndex = -1;
            }

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
                    
                    // ④ホストが勝利数をカウントアップ（一度だけ実行）
                    if (isHost && data.status !== "result_counted") {
                        const winnerId = data.lastGuess.userId;
                        if (winnerId) {
                            const winRef = ref(db, `rooms/kanji-quiz/${roomId}/players/${winnerId}/wins`);
                            onValue(winRef, (snap) => {
                                const currentWins = snap.val() || 0;
                                update(ref(db, `rooms/kanji-quiz/${roomId}/players/${winnerId}`), { wins: currentWins + 1 });
                            }, { onlyOnce: true });
                        }
                        update(ref(db, `rooms/kanji-quiz/${roomId}/state`), { status: "result_counted" });
                    }
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
            if (stage.children.length === 0) {
                for (let i = 0; i < currentWord.length; i++) {
                    const box = document.createElement('div');
                    box.className = 'kanji-box';
                    box.innerHTML = `<svg viewBox="0 0 109 109" id="svg-${i}"></svg>`;
                    stage.appendChild(box);
                }
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

        document.getElementById('submit-btn').onclick = () => {
            const input = document.getElementById('answer-input');
            const guess = input.value.trim();
            if (!guess) return;
            update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                lastGuess: { user: myName, userId: myId, text: guess, correct: (guess === currentWord) }
            });
            input.value = "";
            document.getElementById('wait-msg').classList.remove('hidden');
            setTimeout(() => document.getElementById('wait-msg').classList.add('hidden'), 2000);
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
