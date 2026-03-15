import { db, ref, set, onValue, update } from '../../js/firebase-config.js';
// ① 問題を別ファイルからインポート
import { wordList } from './words.js';

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

        set(ref(db, `rooms/kanji-quiz/${roomId}/players/${myId}`), myName);

        let isHost = false;
        let currentWord = "";
        let shuffledStrokes = [];
        let lastRenderedIndex = -1;
        let nextStepTimer = null;
        let playerCount = 0;
        let currentWordForReset = ""; 

        onValue(ref(db, `rooms/kanji-quiz/${roomId}/players`), (snapshot) => {
            const players = snapshot.val() || {};
            playerCount = Object.keys(players).length;
            const listHtml = Object.values(players).map(name => `<span class="player-tag">${name}</span>`).join('');
            document.getElementById('player-list').innerHTML = listHtml;
        });

        onValue(ref(db, `rooms/kanji-quiz/${roomId}/scores`), (snapshot) => {
            const scores = snapshot.val() || {};
            const scoreListEl = document.getElementById('score-list');
            scoreListEl.innerHTML = "";
            
            onValue(ref(db, `rooms/kanji-quiz/${roomId}/players`), (pSnap) => {
                const players = pSnap.val() || {};
                Object.entries(scores).forEach(([pId, score]) => {
                    const name = players[pId] || "不明";
                    const item = document.createElement('div');
                    item.className = "score-item";
                    item.innerHTML = `<span>${name}</span><span>${score}回</span>`;
                    scoreListEl.appendChild(item);
                });
            }, { onlyOnce: true });
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
                lastGuess: { user: "", text: "", correct: false },
                strokeVotes: {},
                gameVotes: {}
            });
        }

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
            } 
            else if (data.status === "playing") {
                startBtn.classList.add('hidden');
                playUi.classList.remove('hidden');
                resultUi.classList.add('hidden');
                
                // 単語が変わっていたら内部の管理変数をリセット
                if (currentWord !== currentWordForReset) {
                    lastRenderedIndex = -1;
                    currentWordForReset = currentWord;
                }

                const isCorrect = data.lastGuess?.correct;
                updateCanvas(data, isCorrect);

                const sVotes = data.strokeVotes ? Object.keys(data.strokeVotes).length : 0;
                document.getElementById('stroke-vote-count').innerText = `${sVotes}/${playerCount}`;
                
　　　　　　　　　　　if (isHost && !isCorrect) {
                    if (sVotes >= playerCount && playerCount > 0) {
                        // 投票が揃ったら、タイマーを止めてから即座に進む
                        if(nextStepTimer) { clearTimeout(nextStepTimer); nextStepTimer = null; }
                        advanceStroke(data.currentIndex);
                    } else {
                        startStepTimer(data.currentIndex);
                    }
                }
                // Firebase側の投票データ(strokeVotes)を確認して、自分がまだ投票していない状態なら
        // ボタンのロック(votingクラス)を解除する
        if (!data.strokeVotes || !data.strokeVotes[myId]) {
            document.getElementById('stroke-vote-btn').classList.remove('voting');
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

        // ★修正ポイント：updateCanvas内の描画リセットロジック
        function updateCanvas(data, showAll = false) {
            const stage = document.getElementById('kanji-stage');
            
            // 1. 枠の数が違う場合は作り直し
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
            // 2. 枠の数が同じでも、新しい単語の開始（lastRenderedIndexが-1）ならSVGの中身を掃除
            else if (lastRenderedIndex === -1) {
                for (let i = 0; i < currentWord.length; i++) {
                    const svg = document.getElementById(`svg-${i}`);
                    if (svg) svg.innerHTML = '';
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
            // 画を進める前にタイマーをクリア
            if (nextStepTimer) { clearTimeout(nextStepTimer); nextStepTimer = null; }

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

            const isCorrect = (guess === currentWord);
            
            if (isCorrect) {
                onValue(ref(db, `rooms/kanji-quiz/${roomId}/scores/${myId}`), (snapshot) => {
                    const currentScore = snapshot.val() || 0;
                    update(ref(db, `rooms/kanji-quiz/${roomId}/scores`), { [myId]: currentScore + 1 });
                }, { onlyOnce: true });
            }

            update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                lastGuess: { user: myName, text: guess, correct: isCorrect }
            });
            input.value = "";
            document.getElementById('wait-msg').classList.remove('hidden');
            setTimeout(() => document.getElementById('wait-msg').classList.add('hidden'), 2000);
        };

        document.getElementById('stroke-vote-btn').onclick = () => {
    const btn = document.getElementById('stroke-vote-btn');
    
    // もしすでにボタンに 'voting' クラスがついていたら、何もしない（連打防止）
    if (btn.classList.contains('voting')) return;

    // ボタンに 'voting' クラスをつけて色を変える
    btn.classList.add('voting');
    
    // Firebaseに投票を送信
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
