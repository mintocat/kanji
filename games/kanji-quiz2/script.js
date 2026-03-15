import { db, ref, set, onValue, update } from '../../js/firebase-config.js';
import { wordList } from '../kanji-quiz/words.js';

// --- 演出用関数（変更なし） ---
const playSound = (type) => {
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
        osc.type = 'sine';
        [523.25, 659.25, 783.99].forEach((freq, i) => {
            const o = ctx.createOscillator(); const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.frequency.setValueAtTime(freq, now + i * 0.1);
            g.gain.setValueAtTime(0.1, now + i * 0.1); g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
            o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.3);
        });
    } else if (type === 'wrong') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(); osc.stop(now + 0.2);
    } else if (type === 'start') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, now); osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);
        gain.gain.setValueAtTime(0.05, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(); osc.stop(now + 0.2);
    }
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
    /* 手札ボタンのCSS */
    .hand-stroke-btn { background: white; border: 2px solid #8b0000; border-radius: 4px; cursor: pointer; padding: 2px; transition: 0.2s; }
    .hand-stroke-btn:disabled { border-color: #ccc; cursor: not-allowed; opacity: 0.5; }
    .hand-stroke-btn:hover:not(:disabled) { background: #ffe4e1; transform: scale(1.1); }
`;
document.head.appendChild(style);
// --- 演出用関数（ここまで） ---

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myKanjiName') || "名無しさん";

// プレイヤー管理用変数
let roomPlayers = {};
let currentGameState = null;

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
            // ★ 新ゲーム用のパス (kanji-quiz2)
            await set(ref(db, `rooms/kanji-quiz2/${newRoomId}/state`), {
                status: "waiting",
                hostId: myId
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
        let currentWordForReset = ""; 
        let lastRenderedCount = 0; // 何画目まで描画したかのカウント

        // プレイヤー一覧の監視
        onValue(ref(db, `rooms/kanji-quiz2/${roomId}/players`), (snapshot) => {
            roomPlayers = snapshot.val() || {};
            playerCount = Object.keys(roomPlayers).length;
            const listHtml = Object.values(roomPlayers).map(name => `<span class="player-tag">${name}</span>`).join('');
            document.getElementById('player-list').innerHTML = listHtml;
        });

        // スコアの監視
        onValue(ref(db, `rooms/kanji-quiz2/${roomId}/scores`), (snapshot) => {
            const scores = snapshot.val() || {};
            const scoreListEl = document.getElementById('score-list');
            scoreListEl.innerHTML = "";
            Object.entries(scores).forEach(([pId, score]) => {
                const name = roomPlayers[pId] || "不明";
                const item = document.createElement('div');
                item.className = "score-item";
                item.innerHTML = `<span>${name}</span><span>${score}回</span>`;
                scoreListEl.appendChild(item);
            });
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

        // ★ ここが新ゲームルールの核 ★
        async function setupNewGame() {
            const word = wordList[Math.floor(Math.random() * wordList.length)];
            let allStrokes = [];
            for (let i = 0; i < word.length; i++) {
                const strokes = await getStrokes(word[i], i);
                allStrokes = allStrokes.concat(strokes);
            }
            // 全ての画をシャッフル
            allStrokes.sort(() => Math.random() - 0.5);

            const playerIds = Object.keys(roomPlayers);
            // ターンの順番をランダムに決定
            const turnOrder = [...playerIds].sort(() => Math.random() - 0.5);
            
            const hands = {};
            playerIds.forEach(id => hands[id] = []);
            const boardStrokes = [];

            // 均等分配と余りの処理
            if (playerIds.length > 0) {
                const perPlayer = Math.floor(allStrokes.length / playerIds.length);
                let strokeIndex = 0;
                
                for (let id of playerIds) {
                    for (let i = 0; i < perPlayer; i++) {
                        hands[id].push(allStrokes[strokeIndex++]);
                    }
                }
                // 余った画を場の正しい位置へ
                while(strokeIndex < allStrokes.length) {
                    boardStrokes.push(allStrokes[strokeIndex++]);
                }
            } else {
                boardStrokes.push(...allStrokes);
            }

            await set(ref(db, `rooms/kanji-quiz2/${roomId}/state`), {
                word: word,
                allStrokes: allStrokes,
                boardStrokes: boardStrokes,
                hands: hands,
                turnOrder: turnOrder,
                currentTurnIndex: 0,
                status: "playing",
                hostId: myId,
                lastGuess: { user: "", text: "", correct: false },
                gameVotes: {}
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
            } 
            else if (data.status === "playing") {
                startBtn.classList.add('hidden');
                playUi.classList.remove('hidden');
                resultUi.classList.add('hidden');
                
                // 単語が変わっていたらリセット
                if (currentWord !== currentWordForReset) {
                    lastRenderedCount = -1;
                    currentWordForReset = currentWord;
                }

                const isCorrect = data.lastGuess?.correct;
                updateCanvas(data, isCorrect);
                
                // 正解していない時だけ手札とターンUIを描画
                if (!isCorrect) {
                    document.getElementById('turn-ui').classList.remove('hidden');
                    renderHand(data);
                } else {
                    document.getElementById('turn-ui').classList.add('hidden');
                }
            }

            if (data.lastGuess && data.lastGuess.user) {
                document.getElementById('announcement').innerText = `${data.lastGuess.user}：${data.lastGuess.text}`;
                if (data.lastGuess.correct) {
                    showResult(data.lastGuess.user);
                }
            }

            const gVotes = data.gameVotes ? Object.keys(data.gameVotes).length : 0;
            document.getElementById('game-vote-count').innerText = `${gVotes}/${playerCount}`;
            if (isHost && gVotes >= playerCount && playerCount > 0) {
                update(ref(db, `rooms/kanji-quiz2/${roomId}/state`), { gameVotes: {} });
                setupNewGame();
            }
        });

        // 描画ロジック：配列から順番に描くのではなく、場にある画(boardStrokes)を一気に描画する
        function updateCanvas(data, showAll = false) {
            const stage = document.getElementById('kanji-stage');
            
            // 枠の再構築
            if (stage.children.length !== currentWord.length) {
                stage.innerHTML = '';
                for (let i = 0; i < currentWord.length; i++) {
                    const box = document.createElement('div');
                    box.className = 'kanji-box';
                    box.innerHTML = `<svg viewBox="0 0 109 109" id="svg-${i}"></svg>`;
                    stage.appendChild(box);
                }
                lastRenderedCount = -1;
            }

            // 一旦全てクリア
            for (let i = 0; i < currentWord.length; i++) {
                const svg = document.getElementById(`svg-${i}`);
                if (svg) svg.innerHTML = '';
            }

            // 正解時は全ての画を、そうでない時は場に出ている画を描画
            const strokesToDraw = showAll ? (data.allStrokes || []) : (data.boardStrokes || []);

            strokesToDraw.forEach(stroke => {
                const svg = document.getElementById(`svg-${stroke.charIndex}`);
                if(!svg) return;
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", stroke.d);
                if (showAll) path.style.stroke = "#ff0000";
                svg.appendChild(path);
            });

            // 場に新しい画が追加されたら音を鳴らす
            if (!showAll && strokesToDraw.length > lastRenderedCount && lastRenderedCount !== -1) {
                playSound('stroke');
            }
            lastRenderedCount = strokesToDraw.length;
        }

        // ★ 手札とターンのUI描画
        function renderHand(data) {
            const handContainer = document.getElementById('my-hand-container');
            if (!handContainer) return;
            
            handContainer.innerHTML = '';
            const myHand = (data.hands && data.hands[myId]) ? data.hands[myId] : [];
            const isMyTurn = data.turnOrder && data.turnOrder[data.currentTurnIndex] === myId;
            const statusEl = document.getElementById('turn-status');
            
            if (isMyTurn) {
                statusEl.innerText = "★ あなたの番です！画を選んでください ★";
                statusEl.style.color = "#ff0000";
            } else {
                const currentPlayerId = data.turnOrder ? data.turnOrder[data.currentTurnIndex] : null;
                const currentPlayerName = roomPlayers[currentPlayerId] || "誰か";
                statusEl.innerText = `${currentPlayerName} の番です...`;
                statusEl.style.color = "#333";
            }

            // 手札のSVGボタンを生成
            myHand.forEach((stroke, index) => {
                const btn = document.createElement('button');
                btn.className = 'hand-stroke-btn';
                if (!isMyTurn) btn.disabled = true; // 自分の番じゃない時は押せない
                
                // サムネイルSVGを描画
                btn.innerHTML = `<svg viewBox="0 0 109 109" style="width:50px; height:50px;"><path d="${stroke.d}" stroke="#333" stroke-width="3" fill="none"/></svg>`;
                
                btn.onclick = () => {
                    if (!isMyTurn) return;
                    playStrokeFromHand(index);
                };
                handContainer.appendChild(btn);
            });
        }

        // ★ 手札から場に画を出す処理
        function playStrokeFromHand(indexInHand) {
            if (!currentGameState) return;
            let myHand = currentGameState.hands[myId] || [];
            let boardStrokes = currentGameState.boardStrokes || [];
            
            if (myHand.length === 0) return;
            
            // 手札から抜いて場に追加
            const playedStroke = myHand[indexInHand];
            myHand.splice(indexInHand, 1);
            boardStrokes.push(playedStroke);
            
            // 次の人のターンへ移行
            let nextTurn = (currentGameState.currentTurnIndex + 1) % currentGameState.turnOrder.length;

            update(ref(db, `rooms/kanji-quiz2/${roomId}/state`), {
                [`hands/${myId}`]: myHand,
                boardStrokes: boardStrokes,
                currentTurnIndex: nextTurn
            });
        }

        document.getElementById('submit-btn').onclick = () => {
            const input = document.getElementById('answer-input');
            const guess = input.value.trim();
            if (!guess) return;

            const isCorrect = (guess === currentWord);
            
            if (isCorrect) {
                onValue(ref(db, `rooms/kanji-quiz2/${roomId}/scores/${myId}`), (snapshot) => {
                    const currentScore = snapshot.val() || 0;
                    update(ref(db, `rooms/kanji-quiz2/${roomId}/scores`), { [myId]: currentScore + 1 });
                }, { onlyOnce: true });
                playSound('correct'); 
                startSakura(); 
            } else {
                playSound('wrong'); 
            }

            update(ref(db, `rooms/kanji-quiz2/${roomId}/state`), {
                lastGuess: { user: myName, text: guess, correct: isCorrect }
            });
            input.value = "";
            document.getElementById('wait-msg').classList.remove('hidden');
            setTimeout(() => document.getElementById('wait-msg').classList.add('hidden'), 2000);
        };

        document.getElementById('next-game-btn').onclick = () => {
            update(ref(db, `rooms/kanji-quiz2/${roomId}/state/gameVotes`), { [myId]: true });
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
