import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

// --- たねリスト (109個) ---
const SEEDS = "口,木,艹,⺡,日,⺘,⺅,金,一,女,土,火,山,丶,言,丿,糹,⺖,田,大,十,⺮,心,宀,石,亠,貝,禾,又,目,⺼,辶,厶,隹,⺉,力,攵,勹,人,車,疒,寸,米,广,冖,夂,⺨,儿,⻖,酉,頁,彳,几,囗,尸,月,𠂉,厂,子,王,方,匕,白,斤,皿,䒑,灬,止,工,小,廾,夕,衣,𠂇,立,八,刀,匚,戈,巾,士,虍,爫,冂,示,豆,門,耳,羽,兀,㔾,⻗,㐅,欠,丁,⺊,龷,糸,比,⺧,⺌,耂,戊,干,而,丂,户,魚,殳".split(',');

// --- 漢字ロジックデータ (サンプル) ---
const KANJI_LOGIC_DATA = {
    "休": [["⺅", "木"]],
    "佐": [["⺅", "𠂇", "工"], ["⺅", "左"]],
    "枝": [["木", "十", "又"]],
    "健": [["⺅", "建"]],
    "建": [["廴", "聿"]], // 簡略化。実際はさらに細かく定義可能
};

let roomId, myId, myName;
let gameState = null;
let selectedSeeds = [];
let selectedPublicKanjiIndex = -1;
let hasDrawn = false; // ①の操作をしたか

// 重み付き山札から1枚引く
function getRandomSeed() {
    const r = Math.random() * 100;
    if (r < 30) return SEEDS[Math.floor(Math.random() * 27)]; // 前半27個 (30%)
    if (r < 57) return SEEDS[27 + Math.floor(Math.random() * 27)]; // 次の27個 (27%)
    if (r < 80) return SEEDS[54 + Math.floor(Math.random() * 27)]; // 次の27個 (23%)
    return SEEDS[81 + Math.floor(Math.random() * 28)]; // 最後28個 (20%)
}

// 初期化・入室処理などは省略（これまでのクイズと同様のFirebase構成を想定）

// --- メインロジック ---

// メルト判定
function checkMelt(selected) {
    const sortedSelected = [...selected].sort();
    for (const [kanji, recipes] of Object.entries(KANJI_LOGIC_DATA)) {
        for (const recipe of recipes) {
            if (recipe.length === sortedSelected.length && [...recipe].sort().join(',') === sortedSelected.join(',')) {
                return { kanji, components: recipe };
            }
        }
    }
    return null;
}

// 付ける判定
function checkAttach(targetItem, handSeeds) {
    // ターゲットの漢字が持つ元の「たね」と、手札の「たね」を合体
    const combined = [...targetItem.components, ...handSeeds].sort();
    for (const [kanji, recipes] of Object.entries(KANJI_LOGIC_DATA)) {
        for (const recipe of recipes) {
            if (recipe.length === combined.length && [...recipe].sort().join(',') === combined.join(',')) {
                return { kanji, components: recipe };
            }
        }
    }
    return null;
}

// --- UI更新 ---
function renderGame() {
    if (!gameState) return;
    const isMyTurn = gameState.turnOrder[gameState.currentTurnIndex] === myId;
    
    // ライフ表示
    document.getElementById('my-life').innerText = `❤️ x ${gameState.lifes[myId]}`;

    // 公開エリア
    const publicArea = document.getElementById('public-area');
    publicArea.innerHTML = '';
    (gameState.publicArea || []).forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = `melted-kanji ${selectedPublicKanjiIndex === idx ? 'selected' : ''}`;
        div.innerText = item.kanji;
        div.onclick = () => {
            selectedPublicKanjiIndex = (selectedPublicKanjiIndex === idx) ? -1 : idx;
            renderGame();
        };
        publicArea.appendChild(div);
    });

    // 手札
    const handDiv = document.getElementById('my-hand');
    handDiv.innerHTML = '';
    const myHand = gameState.hands[myId] || [];
    myHand.forEach((seed, idx) => {
        const div = document.createElement('div');
        div.className = `seed-card ${selectedSeeds.includes(idx) ? 'selected' : ''}`;
        div.innerText = seed;
        div.onclick = () => {
            if (selectedSeeds.includes(idx)) {
                selectedSeeds = selectedSeeds.filter(i => i !== idx);
            } else {
                selectedSeeds.push(idx);
            }
            renderGame();
        };
        handDiv.appendChild(div);
    });

    // ボタン活性制御
    document.getElementById('melt-btn').disabled = !isMyTurn || !hasDrawn || selectedSeeds.length < 2;
    document.getElementById('attach-btn').disabled = !isMyTurn || !hasDrawn || selectedSeeds.length < 1 || selectedPublicKanjiIndex === -1;
    document.getElementById('discard-btn').disabled = !isMyTurn || !hasDrawn || selectedSeeds.length !== 1;
}

// --- ボタンアクション ---

// ① ドロー
document.getElementById('deck').onclick = async () => {
    if (hasDrawn || !isMyTurn()) return;
    const newSeed = getRandomSeed();
    const newHand = [...gameState.hands[myId], newSeed];
    await update(ref(db, `rooms/rummy/${roomId}/state/hands`), { [myId]: newHand });
    hasDrawn = true;
    renderGame();
};

// ② メルト
document.getElementById('melt-btn').onclick = async () => {
    const selectedSeedValues = selectedSeeds.map(idx => gameState.hands[myId][idx]);
    const result = checkMelt(selectedSeedValues);

    if (result) {
        // 成功：手札から消し、公開エリアへ
        let newHand = gameState.hands[myId].filter((_, i) => !selectedSeeds.includes(i));
        let newPublic = [...(gameState.publicArea || []), result];
        await update(ref(db, `rooms/rummy/${roomId}/state`), {
            [`hands/${myId}`]: newHand,
            publicArea: newPublic
        });
        selectedSeeds = [];
        if (newHand.length === 0) alert("上がり！勝利です！");
    } else {
        // 失敗：ライフ減少
        penalize();
    }
};

// ② 付ける
document.getElementById('attach-btn').onclick = async () => {
    const targetItem = gameState.publicArea[selectedPublicKanjiIndex];
    const handSeeds = selectedSeeds.map(idx => gameState.hands[myId][idx]);
    const result = checkAttach(targetItem, handSeeds);

    if (result) {
        let newHand = gameState.hands[myId].filter((_, i) => !selectedSeeds.includes(i));
        let newPublic = [...gameState.publicArea];
        newPublic[selectedPublicKanjiIndex] = result; // 漢字を更新
        await update(ref(db, `rooms/rummy/${roomId}/state`), {
            [`hands/${myId}`]: newHand,
            publicArea: newPublic
        });
        selectedSeeds = [];
        selectedPublicKanjiIndex = -1;
    } else {
        penalize();
    }
};

// ③ 捨てる
document.getElementById('discard-btn').onclick = async () => {
    const discardIdx = selectedSeeds[0];
    const discardSeed = gameState.hands[myId][discardIdx];
    let newHand = gameState.hands[myId].filter((_, i) => i !== discardIdx);
    
    const nextTurn = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
    
    await update(ref(db, `rooms/rummy/${roomId}/state`), {
        [`hands/${myId}`]: newHand,
        discardPileTop: discardSeed,
        currentTurnIndex: nextTurn
    });
    
    hasDrawn = false;
    selectedSeeds = [];
    renderGame();
};

function penalize() {
    const currentLife = gameState.lifes[myId];
    if (currentLife <= 1) {
        alert("ライフがなくなりました。あなたの負けです。");
    }
    update(ref(db, `rooms/rummy/${roomId}/state/lifes`), { [myId]: currentLife - 1 });
    document.getElementById('system-msg').innerText = "判定失敗！ライフを1失いました。";
}
