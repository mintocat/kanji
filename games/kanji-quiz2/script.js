import { db, ref, set, onValue, update } from '../../js/firebase-config.js';
import { wordList } from '../kanji-quiz/words.js';

// --- 演出用関数（変更なし） ---
const playSound = (type) => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        const now = ctx.currentTime;

        if (type === 'stroke') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
            gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(); osc.stop(now + 0.1);
        } else if (type === 'correct') {
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const o = ctx.createOscillator(); const g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.frequency.setValueAtTime(freq, now + i * 0.1);
                g.gain.setValueAtTime(0.1, now + i * 0.1); g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
                o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.3);
            });
        } else if (type === 'wrong') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now);
            gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(); osc.stop(now + 0.2);
        } else if (type === 'start') {
            osc.type = 'square'; osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);
            gain.gain.setValueAtTime(0.05, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(); osc.stop(now + 0.2);
        }
    } catch(e) { console.log("Audio Error"); }
};

const startSakura = () => {
    const container = document.body;
    for (let i = 0; i < 50; i++) {
        const petal = document.createElement('div');
        petal.className = 'sakura-petal';
        petal.style.left = Math.random() * 100 + 'vw';
        petal.style.animationDelay = Math.random() * 3 + 's';
        petal.style.opacity = Math.random();
        container.appendChild(petal);
        setTimeout(() => petal.remove(), 6000);
    }
};

const style = document.createElement('style');
style.textContent = `
    .sakura-petal { position: fixed; top: -10px; width: 15px; height: 10px; background: #ffb7c5; border-radius: 10px 0 10px 0; z-index: 9999; pointer-events: none; animation: fall 6s linear forwards; }
    @keyframes fall { 0% { transform: translateY(0) rotate(0deg); } 100% { transform: translateY(110vh) rotate(720deg); } }
    .hand-stroke-btn { background: white; border: 2px solid #8b0000; border-radius: 4px; cursor: pointer; padding: 2px; transition: 0.2s; width: 60px; height: 60px; }
    .hand-stroke-btn:disabled { border-color: #ccc; cursor: not-allowed; opacity: 0.3; filter: grayscale(1); }
    .hand-stroke-btn:hover:not(:disabled) { background: #ffe4e1; transform: scale(1.1); box-shadow: 0 0 10px rgba(139,0,0,0.3); }
`;
document.head.appendChild(style);

// --- ゲームロジック ---
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myKanjiName') || "名無しさん";

let roomPlayers = {};
let currentGameState = null;
let selectedStrokeIndex = -1; // 選択中の手札インデックス

window.addEventListener('DOMContentLoaded', () => {
    if (!roomId) {
        document.getElementById('lobby-ui').classList.remove('hidden');
        document.getElementById('lobby-my-name').innerText = myName;
        document.getElementById('save-name-btn').onclick = () => {
            const val = document.getElementById('name-input').value.trim();
            if (val) { myName = val; localStorage.setItem('myKanjiName', val); document.getElementById('lobby-my-name').innerText = val; }
        };
        document.getElementById('create-room-btn').onclick = async () => {
            const newRoomId = Math.floor(100 + Math.random() * 900).toString();
            const gravityMode = document.getElementById('gravity-mode-check').checked;
            await set(ref(db, `rooms/kanji-quiz2/${newRoomId}/state`), { 
                status: "waiting", 
                hostId: myId,
                gravityMode: gravityMode
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

        set(ref(db, `rooms/kanji-quiz2/${roomId}/players/${myId}`), myName);

        let isHost = false;
        let currentWord = "";
        let playerCount = 0;
        let lastRenderedCount = 0;

        onValue(ref(db, `rooms/kanji-quiz2/${roomId}/players`), (snapshot) => {
            roomPlayers = snapshot.val() || {};
            playerCount = Object.keys(roomPlayers).length;
            document.getElementById('player-list').innerHTML = Object.values(roomPlayers).map(name => `<span class="player-tag">${name}</span>`).join('');
        });

        onValue(ref(db, `rooms/kanji-quiz2/${roomId}/scores`), (snapshot) => {
            const scores = snapshot.val() || {};
            const list = document.getElementById('score-list');
            list.innerHTML = Object.entries(scores).map(([pId, s]) => `<div class="score-item"><span>${roomPlayers[pId] || '...'}</span><span>${s}回</span></div>`).sort((a,b) => b.score - a.score).join('');
        });

        async function getStrokes(char, charIndex) {
            const unicode = char.charCodeAt(0).toString(16).padStart(5, '0');
            const url = `https://cdn.jsdelivr.net/gh/kanjivg/kanjivg/kanji/${unicode}.svg`;
            const resp = await fetch(url);
            const text = await resp.text();
            const doc = new DOMParser().parseFromString(text, "image/xml+svg");
            return Array.from(doc.querySelectorAll('path')).map(p => ({ d: p.getAttribute('d'), charIndex }));
        }

        async function setupNewGame() {
            const word = wordList[Math.floor(Math.random() * wordList.length)];
            let allStrokes = [];
            for (let i = 0; i < word.length; i++) {
                const s = await getStrokes(word[i], i);
                allStrokes = allStrokes.concat(s);
            }
            allStrokes.sort(() => Math.random() - 0.5);

            const pIds = Object.keys(roomPlayers);
            const turnOrder = [...pIds].sort(() => Math.random() - 0.5);
            const hands = {};
            pIds.forEach(id => hands[id] = []);
            
            const perPlayer = Math.floor(allStrokes.length / pIds.length);
            let sIdx = 0;
            pIds.forEach(id => {
                for(let i=0; i<perPlayer; i++) hands[id].push(allStrokes[sIdx++]);
            });
            const boardStrokes = allStrokes.slice(sIdx);

            await update(ref(db, `rooms/kanji-quiz2/${roomId}/state`), {
                word, allStrokes, boardStrokes, hands, turnOrder,
                currentTurnIndex: 0, status: "playing", hostId: myId,
                lastGuess: { user: "", text: "", correct: false }, gameVotes: {}
            });
            playSound('start');
        }

        onValue(ref(db, `rooms/kanji-quiz2/${roomId}/state`), (snapshot) => {
            const data = snapshot.val();
            if (!data) return;
            currentGameState = data;
            isHost = (data.hostId === myId);
            currentWord = data.word || "";

            const startBtn = document.getElementById('start-btn');
            const playUi = document.getElementById('play-ui');
            const resultUi = document.getElementById('result-ui');

            if (data.status === "waiting") {
                startBtn.classList.toggle('hidden', !isHost);
                playUi.classList.add('hidden');
                resultUi.classList.add('hidden');
            } else if (data.status === "playing") {
                startBtn.classList.add('hidden');
                
                const isCorrect = data.lastGuess?.correct;
                updateCanvas(data, isCorrect);
                
                if (isCorrect) {
                    playUi.classList.add('hidden');
                    resultUi.classList.remove('hidden');
                    showResult(data.lastGuess.user);
                } else {
                    playUi.classList.remove('hidden');
                    resultUi.classList.add('hidden');
                    renderHand(data);
                }
            }

            if (data.lastGuess?.user && !data.lastGuess.correct) {
                document.getElementById('announcement').innerText = `${data.lastGuess.user}：${data.lastGuess.text}`;
            }

            const gVotes = data.gameVotes ? Object.keys(data.gameVotes).length : 0;
            document.getElementById('game-vote-count').innerText = `${gVotes}/${playerCount}`;
            if (isHost && gVotes >= playerCount && playerCount > 0 && data.status === "playing" && data.lastGuess?.correct) {
                setupNewGame();
            }
        });

        function updateCanvas(data, showAll) {
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

            for (let i = 0; i < currentWord.length; i++) {
                const svg = document.getElementById(`svg-${i}`);
                if (svg) svg.innerHTML = '';
            }

            const strokes = showAll ? data.allStrokes : data.boardStrokes;
            if (strokes) {
                strokes.forEach(s => {
                    const svg = document.getElementById(`svg-${s.charIndex}`);
                    if(!svg) return;
                    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    p.setAttribute("d", s.d);
                    if (showAll) p.style.stroke = "#ff0000";
                    svg.appendChild(p);
                });
                if (!showAll && strokes.length > lastRenderedCount) playSound('stroke');
                lastRenderedCount = strokes.length;
            }
        }

        // 重心モード用のトランスフォーム計算
        function getGravityTransform(pathD) {
            const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
            tempPath.setAttribute("d", pathD);
            tempSvg.appendChild(tempPath);
            tempSvg.style.visibility = "hidden";
            tempSvg.style.position = "absolute";
            document.body.appendChild(tempSvg);
            
            const bbox = tempPath.getBBox();
            document.body.removeChild(tempSvg);

            // パーツの中心を枠の中心(54.5, 54.5)に移動させる
            const dx = 54.5 - (bbox.x + bbox.width / 2);
            const dy = 54.5 - (bbox.y + bbox.height / 2);
            return `translate(${dx}, ${dy})`;
        }

        function renderHand(data) {
            const container = document.getElementById('my-hand-container');
            container.innerHTML = '';
            const myHand = data.hands?.[myId] || [];
            const isMyTurn = data.turnOrder?.[data.currentTurnIndex] === myId;
            const statusEl = document.getElementById('turn-status');

            if (isMyTurn) {
                statusEl.innerText = "★ あなたの番です！ ★";
                statusEl.style.color = "#8b0000";
            } else {
                const curName = roomPlayers[data.turnOrder?.[data.currentTurnIndex]] || "誰か";
                statusEl.innerText = `${curName} の番です...`;
                statusEl.style.color = "#666";
            }

            myHand.forEach((s, i) => {
                const btn = document.createElement('button');
                btn.className = `hand-stroke-btn ${selectedStrokeIndex === i ? 'selected' : ''}`;
                btn.disabled = !isMyTurn;
                
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("viewBox", "0 0 109 109");
                const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
                p.setAttribute("d", s.d);
                p.setAttribute("stroke", "#333");
                p.setAttribute("stroke-width", "4");
                p.setAttribute("fill", "none");

                // 重心モードがONならパーツを中央に寄せる
                if (data.gravityMode) {
                    p.setAttribute("transform", getGravityTransform(s.d));
                }

                svg.appendChild(p);
                btn.appendChild(svg);

                btn.onclick = () => {
                    if (!isMyTurn) return;
                    if (selectedStrokeIndex === i) {
                        // 2回目のクリック：場に出す
                        confirmPlayStroke(i);
                        selectedStrokeIndex = -1;
                    } else {
                        // 1回目のクリック：選択する
                        selectedStrokeIndex = i;
                        renderHand(data);
                    }
                };
                container.appendChild(btn);
            });
        }

        function confirmPlayStroke(i) {
            const myHand = [...currentGameState.hands[myId]];
            const played = myHand.splice(i, 1)[0];
            const newBoard = [...currentGameState.boardStrokes, played];
            const nextIdx = (currentGameState.currentTurnIndex + 1) % currentGameState.turnOrder.length;
            
            update(ref(db, `rooms/kanji-quiz2/${roomId}/state`), {
                [`hands/${myId}`]: myHand,
                boardStrokes: newBoard,
                currentTurnIndex: nextIdx
            });
        }

        document.getElementById('submit-btn').onclick = () => {
            const input = document.getElementById('answer-input');
            const guess = input.value.trim();
            if (!guess) return;
            const isCorrect = (guess === currentWord);
            if (isCorrect) {
                onValue(ref(db, `rooms/kanji-quiz2/${roomId}/scores/${myId}`), (s) => {
                    update(ref(db, `rooms/kanji-quiz2/${roomId}/scores`), { [myId]: (s.val() || 0) + 1 });
                }, { onlyOnce: true });
                playSound('correct'); startSakura();
            } else { playSound('wrong'); }
            update(ref(db, `rooms/kanji-quiz2/${roomId}/state`), { lastGuess: { user: myName, text: guess, correct: isCorrect } });
            input.value = "";
        };

        document.getElementById('next-game-btn').onclick = () => {
            update(ref(db, `rooms/kanji-quiz2/${roomId}/state/gameVotes`), { [myId]: true });
        };

        function showResult(winner) {
            document.getElementById('winner-msg').innerText = `正解！勝者: ${winner}`;
            document.getElementById('correct-word-display').innerText = currentWord;
            document.getElementById('announcement').innerText = "";
        }

        document.getElementById('start-btn').onclick = setupNewGame;
    }
});
