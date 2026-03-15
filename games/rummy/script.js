import { db, ref, set, onValue, update } from '../../js/firebase-config.js';
import { KANJI_LOGIC_DATA } from './kanji_logic.js'; // 外部データをインポート

// --- たねリスト (109個) ---
const SEEDS = "口,木,艹,⺡,日,⺘,⺅,金,一,女,土,火,山,丶,言,丿,糹,⺖,田,大,十,⺮,心,宀,石,亠,貝,禾,又,目,⺼,辶,厶,隹,⺉,力,攵,勹,人,車,疒,寸,米,广,冖,夂,⺨,儿,⻖,酉,頁,彳,几,囗,尸,月,𠂉,厂,子,王,方,匕,白,斤,皿,䒑,灬,止,工,小,廾,夕,衣,𠂇,立,八,刀,匚,戈,巾,士,虍,爫,冂,示,豆,門,耳,羽,兀,㔾,⻗,㐅,欠,丁,⺊,龷,糸,比,⺧,⺌,耂,戊,干,而,丂,户,魚,殳".split(',');

// 重み付き抽選ロジック
function drawFromWeightedDeck() {
    const r = Math.random() * 100;
    if (r < 30) return SEEDS[Math.floor(Math.random() * 27)];      // 前半27個: 30%
    if (r < 57) return SEEDS[27 + Math.floor(Math.random() * 27)]; // 次の27個: 27%
    if (r < 80) return SEEDS[54 + Math.floor(Math.random() * 27)]; // 次の27個: 23%
    return SEEDS[81 + Math.floor(Math.random() * 28)];             // 残り28個: 20%
}

// --- 判定アルゴリズム ---

// メルト判定：選択した「たね」だけで作れる漢字を探す
function findMeltableKanji(selectedSeeds) {
    const target = [...selectedSeeds].sort().join(',');
    const matches = [];
    
    for (const [kanji, recipes] of Object.entries(KANJI_LOGIC_DATA)) {
        for (const recipe of recipes) {
            if ([...recipe].sort().join(',') === target) {
                matches.push({ kanji, components: recipe });
            }
        }
    }
    // 複数ある場合はランダムに1つ返す
    return matches.length > 0 ? matches[Math.floor(Math.random() * matches.length)] : null;
}

// 付ける判定：公開エリアの漢字の構成 + 手札のたね
function findAttachableKanji(targetItem, addedSeeds) {
    const combined = [...targetItem.components, ...addedSeeds].sort().join(',');
    const matches = [];

    for (const [kanji, recipes] of Object.entries(KANJI_LOGIC_DATA)) {
        for (const recipe of recipes) {
            if ([...recipe].sort().join(',') === combined) {
                matches.push({ kanji, components: recipe });
            }
        }
    }
    return matches.length > 0 ? matches[Math.floor(Math.random() * matches.length)] : null;
}

// --- ゲームのアクション処理 ---

async function handleMelt() {
    const selectedValues = selectedSeeds.map(idx => gameState.hands[myId][idx]);
    const result = findMeltableKanji(selectedValues);

    if (result) {
        // 成功時の処理
        const newHand = gameState.hands[myId].filter((_, i) => !selectedSeeds.includes(i));
        const newPublic = [...(gameState.publicArea || []), result];
        
        await update(ref(db, `rooms/rummy/${roomId}/state`), {
            [`hands/${myId}`]: newHand,
            publicArea: newPublic
        });
        clearSelection();
        if (newHand.length === 0) endGame(myId);
    } else {
        // 失敗：ライフを減らす
        applyPenalty();
    }
}

async function handleAttach() {
    if (selectedPublicKanjiIndex === -1) return;
    
    const targetItem = gameState.publicArea[selectedPublicKanjiIndex];
    const addedSeedValues = selectedSeeds.map(idx => gameState.hands[myId][idx]);
    const result = findAttachableKanji(targetItem, addedSeedValues);

    if (result) {
        const newHand = gameState.hands[myId].filter((_, i) => !selectedSeeds.includes(i));
        const newPublic = [...gameState.publicArea];
        newPublic[selectedPublicKanjiIndex] = result; // 漢字をアップグレード

        await update(ref(db, `rooms/rummy/${roomId}/state`), {
            [`hands/${myId}`]: newHand,
            publicArea: newPublic
        });
        clearSelection();
        if (newHand.length === 0) endGame(myId);
    } else {
        applyPenalty();
    }
}

// ライフ減少処理
async function applyPenalty() {
    const currentLife = gameState.lifes[myId];
    const nextLife = currentLife - 1;
    
    await update(ref(db, `rooms/rummy/${roomId}/state/lifes`), { [myId]: nextLife });
    
    if (nextLife <= 0) {
        alert("ライフが尽きました...脱落です。");
        // 脱落時の処理（手札を捨て札にする、など）
    } else {
        alert(`判定失敗！ ライフ残り: ${nextLife}`);
    }
}
