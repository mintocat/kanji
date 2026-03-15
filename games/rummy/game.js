// ==========================================
// 1. 定数と初期データの設定
// ==========================================
const TANE_LIST = [
    "口","木","艹","⺡","日","⺘","⺅","金","一","女","土","火","山","丶","言","丿","糹","⺖","田","大","十","⺮","心","宀","石","亠","貝", // 前半27個 (30%)
    "禾","又","目","⺼","辶","厶","隹","⺉","力","攵","勹","人","車","疒","寸","米","广","冖","夂","⺨","儿","⻖","酉","頁","彳","几","囗", // 次の27個 (27%)
    "尸","月","𠂉","厂","子","王","方","匕","白","斤","皿","䒑","灬","止","工","小","廾","夕","衣","𠂇","立","八","刀","匚","戈","巾","士", // 次の27個 (23%)
    "虍","爫","冂","示","豆","門","耳","羽","兀","㔾","⻗","㐅","欠","丁","⺊","龷","糸","比","⺧","⺌","耂","戊","干","而","丂","户","魚","殳" // 最後の28個 (20%)
];

// JSONデータの格納先
let kanjiLogic = {};

// ゲームのステータス
let deck = [];
let hand = [];
let tableMelds = []; // 場に出た完成漢字
let selectedHandIndices = new Set(); // 選択中の手札のインデックス

// ==========================================
// 2. 山札（デッキ）の生成ロジック
// ==========================================
function generateDeck() {
    let newDeck = [];
    
    // 全体約1000枚のデッキを想定し、比率に応じて1種類あたりの投入枚数を決める
    // グループ1 (27種) x 11枚 = 297枚 (約30%)
    // グループ2 (27種) x 10枚 = 270枚 (約27%)
    // グループ3 (27種) x 8枚  = 216枚 (約22%)
    // グループ4 (残種) x 7枚  = 残り  (約21%)
    
    TANE_LIST.forEach((tane, index) => {
        let count = 0;
        if (index < 27) count = 11;
        else if (index < 54) count = 10;
        else if (index < 81) count = 8;
        else count = 7;

        for (let i = 0; i < count; i++) {
            newDeck.push(tane);
        }
    });

    // Fisher-Yatesアルゴリズムでシャッフル
    for (let i = newDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }

    return newDeck;
}

// ==========================================
// 3. ゲーム進行ロジック
// ==========================================

// 初期化（JSONを読み込んでゲームスタート）
async function initGame() {
    try {
        const response = await fetch('kanji_rummy_logic.json');
        if (!response.ok) throw new Error("JSONの読み込みに失敗しました");
        kanjiLogic = await response.json();
        console.log(`辞書をロードしました。収録漢字数: ${Object.keys(kanjiLogic).length}`);
    } catch (error) {
        alert("辞書データの読み込みに失敗しました。ローカルサーバーで実行していますか？");
        console.error(error);
        return;
    }

    // デッキを生成し、最初の手札を7枚引く
    deck = generateDeck();
    hand = [];
    for (let i = 0; i < 7; i++) {
        hand.push(deck.pop());
    }
    
    updateUI();
}

// 山札から引く
function drawTile() {
    if (deck.length > 0) {
        hand.push(deck.pop());
        updateUI();
        // ラミーの基本：引いたら、役を作るか捨てるかのフェーズへ（引くボタンは無効化）
        document.getElementById('btn-draw').disabled = true;
    }
}

// 手札を捨てる
function discardTile() {
    if (selectedHandIndices.size !== 1) {
        alert("捨てる牌を1つだけ選んでください。");
        return;
    }
    
    const indexToDiscard = Array.from(selectedHandIndices)[0];
    const discardedTile = hand.splice(indexToDiscard, 1)[0];
    
    // ここでターン終了。次のターンへ（今回はソロ用なので、状態をリセットするだけ）
    selectedHandIndices.clear();
    document.getElementById('btn-draw').disabled = false; // 次のドローを許可
    
    console.log(`「${discardedTile}」を捨てました`);
    updateUI();
}

// ==========================================
// 4. 役（メルト）の判定ロジック
// ==========================================
function meldKanji() {
    if (selectedHandIndices.size < 2) {
        alert("役を作るには2枚以上の牌を選んでください。");
        return;
    }

    // 選択された牌の文字列配列を取得
    const selectedTiles = Array.from(selectedHandIndices).map(idx => hand[idx]);
    
    // どの漢字が作れるか、辞書を総当たりで探す
    let createdKanji = null;

    for (const [kanji, patterns] of Object.entries(kanjiLogic)) {
        for (const pattern of patterns) {
            if (isSameTiles(pattern, selectedTiles)) {
                createdKanji = kanji;
                break;
            }
        }
        if (createdKanji) break;
    }

    if (createdKanji) {
        alert(`お見事！「${createdKanji}」が完成しました！`);
        // 手札から消費する（インデックスを降順にソートして削除するとズレない）
        const indicesToRemove = Array.from(selectedHandIndices).sort((a, b) => b - a);
        indicesToRemove.forEach(idx => hand.splice(idx, 1));
        
        selectedHandIndices.clear();
        // 場に追加する処理などをここに書く
        
        updateUI();
    } else {
        alert("その組み合わせで作れる漢字は辞書にありません！");
    }
}

// 配列の中身が完全に一致するか判定
function isSameTiles(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    return sorted1.every((val, index) => val === sorted2[index]);
}

// ==========================================
// 5. UIの更新処理
// ==========================================
function updateUI() {
    document.getElementById('deck-info').innerText = `山札: ${deck.length} 枚`;
    
    const handContainer = document.getElementById('hand-tiles');
    handContainer.innerHTML = ''; // クリア

    hand.forEach((tane, index) => {
        const tileDiv = document.createElement('div');
        tileDiv.className = 'tile';
        if (selectedHandIndices.has(index)) {
            tileDiv.classList.add('selected');
        }
        tileDiv.innerText = tane;
        
        // クリックで選択・選択解除
        tileDiv.onclick = () => {
            if (selectedHandIndices.has(index)) {
                selectedHandIndices.delete(index);
            } else {
                selectedHandIndices.add(index);
            }
            updateUI();
        };
        
        handContainer.appendChild(tileDiv);
    });

    // ボタンの有効化・無効化
    document.getElementById('btn-discard').disabled = selectedHandIndices.size !== 1;
    document.getElementById('btn-meld').disabled = selectedHandIndices.size < 2;
}

// ページ読み込み完了時にゲーム初期化
window.onload = initGame;
