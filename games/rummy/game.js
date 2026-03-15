import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

// --- 定数 ---
const TANE_LIST = ["口","木","艹","⺡","日","⺘","⺅","金","一","女","土","火","山","丶","言","丿","糹","⺖","田","大","十","⺮","心","宀","石","亠","貝","禾","又","目","⺼","辶","厶","隹","⺉","力","攵","勹","人","車","疒","寸","米","广","冖","夂","⺨","儿","⻖","酉","頁","彳","几","囗","尸","月","𠂉","厂","子","王","方","匕","白","斤","皿","䒑","灬","止","工","小","廾","夕","衣","𠂇","立","八","刀","匚","戈","巾","士","虍","爫","冂","示","豆","門","耳","羽","兀","㔾","⻗","㐅","欠","丁","⺊","龷","糸","比","⺧","⺌","耂","戊","干","而","丂","戸","魚","殳"];

let myIndex = null;
let roomId = null;
let roomRef = null;
let selectedHand = new Set();
let selectedTable = new Set();

// --- UI操作ヘルパー ---
const show = (id) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
};

// --- イベントリスナー設定 ---
document.getElementById('btn-to-host').onclick = () => show('screen-host');
document.getElementById('btn-to-join').onclick = () => show('screen-join');
document.getElementById('btn-host-back').onclick = () => show('screen-lobby');
document.getElementById('btn-join-back').onclick = () => show('screen-lobby');

// --- 部屋作成 (ホスト) ---
document.getElementById('btn-create-exec').onclick = async () => {
    const name = document.getElementById('input-name').value || "ホスト";
    const handSize = parseInt(document.getElementById('input-hand-size').value);
    roomId = Math.floor(100 + Math.random() * 899).toString();
    myIndex = 0;

    let deck = [];
    const counts = [11, 10, 8, 7];
    TANE_LIST.forEach((t, i) => {
        let g = Math.min(3, Math.floor(i / 27));
        for (let j = 0; j < counts[g]; j++) deck.push(t);
    });
    deck.sort(() => Math.random() - 0.5);

    roomRef = ref(db, 'rooms/' + roomId);
    await set(roomRef, {
        roomId, handSize, deck, table: [], turnIndex: 0, hasDrawn: false,
        players: [{ name, hand: [] }],
        logs: ["部屋作成完了 ID:" + roomId],
        status: "waiting"
    });
    startSync();
};

// --- 入室 (ゲスト) ---
document.getElementById('btn-join-exec').onclick = async () => {
    const name = document.getElementById('input-name').value || "ゲスト";
    roomId = document.getElementById('input-room-id').value;
    if (roomId.length !== 3) return alert("3桁のIDを入れてください");

    roomRef = ref(db, 'rooms/' + roomId);
    onValue(roomRef, async (snap) => {
        const data = snap.val();
        if (!data || data.players.length >= 2 || data.status !== "waiting") return;
        
        myIndex = 1;
        let { players, deck, handSize } = data;
        players.push({ name, hand: [] });
        // 手札配布
        for (let p = 0; p < 2; p++) {
            for (let i = 0; i < handSize; i++) players[p].hand.push(deck.pop());
        }
        await update(roomRef, { players, deck, status: "playing", logs: [...data.logs, name + "が参戦！"] });
        startSync();
    }, { onlyOnce: true });
};

// --- 同期開始 ---
function startSync() {
    show('screen-game');
    document.getElementById('display-room-id').innerText = `ID: ${roomId}`;
    onValue(roomRef, (snap) => {
        const data = snap.val();
        if (data) render(data);
    });
}

// --- 描画処理 ---
function render(data) {
    const isMyTurn = data.turnIndex === myIndex;
    const me = data.players[myIndex] || { hand: [] };
    const currentName = data.players[data.turnIndex].name;

    document.getElementById('display-turn').innerText = `${currentName}の番`;
    document.getElementById('display-turn').style.color = isMyTurn ? "#8e2b12" : "white";
    document.getElementById('display-deck').innerText = `山札: ${data.deck.length}`;

    // 手札
    const handEl = document.getElementById('hand-tiles');
    handEl.innerHTML = '';
    me.hand.forEach((t, i) => {
        const d = document.createElement('div');
        d.className = `tile ${selectedHand.has(i) ? 'selected' : ''}`;
        d.innerText = t;
        d.onclick = () => { if(isMyTurn) { selectedHand.has(i) ? selectedHand.delete(i) : selectedHand.add(i); render(data); }};
        handEl.appendChild(d);
    });

    // 場
    const tableEl = document.getElementById('table-tiles');
    tableEl.innerHTML = '';
    (data.table || []).forEach((m, i) => {
        const d = document.createElement('div');
        d.className = `meld-box tile ${selectedTable.has(i) ? 'selected' : ''}`;
        d.innerHTML = `<div class="meld-kanji">${m.kanji}</div><div class="meld-source">${m.parts.join('')}</div>`;
        d.onclick = () => { if(isMyTurn) { selectedTable.has(i) ? selectedTable.delete(i) : selectedTable.add(i); render(data); }};
        tableEl.appendChild(d);
    });

    // ログ
    document.getElementById('game-log').innerHTML = data.logs.slice(-5).reverse().map(l => `<div>・${l}</div>`).join('');

    // ボタン制御
    document.getElementById('btn-draw').onclick = () => doAction('draw');
    document.getElementById('btn-meld').onclick = () => doAction('meld');
    document.getElementById('btn-discard').onclick = () => doAction('discard');

    document.getElementById('btn-draw').disabled = !isMyTurn || data.hasDrawn;
    document.getElementById('btn-meld').disabled = !isMyTurn || (selectedHand.size + selectedTable.size) < 2;
    document.getElementById('btn-discard').disabled = !isMyTurn || !data.hasDrawn || selectedHand.size !== 1;
}

// --- アクション実行 ---
async function doAction(type) {
    onValue(roomRef, async (snap) => {
        const data = snap.val();
        let { players, deck, table, turnIndex, hasDrawn, logs } = data;
        const myHand = players[myIndex].hand;

        if (type === 'draw') {
            myHand.push(deck.pop());
            hasDrawn = true;
            logs.push(`${players[myIndex].name}が引きました`);
        } else if (type === 'discard') {
            const idx = Array.from(selectedHand)[0];
            const t = myHand.splice(idx, 1)[0];
            turnIndex = (turnIndex + 1) % 2;
            hasDrawn = false;
            logs.push(`${players[myIndex].name}が「${t}」を捨てました`);
            selectedHand.clear(); selectedTable.clear();
        } else if (type === 'meld') {
            const tilesH = Array.from(selectedHand).map(i => myHand[i]);
            const tilesT = Array.from(selectedTable).map(i => table[i].kanji);
            const combined = [...tilesH, ...tilesT];
            let found = Object.keys(KANJI_LOGIC_DATA).find(k => 
                KANJI_LOGIC_DATA[k].some(p => [...p].sort().join('') === combined.sort().join(''))
            );
            if (found) {
                Array.from(selectedHand).sort((a,b)=>b-a).forEach(i => myHand.splice(i, 1));
                Array.from(selectedTable).sort((a,b)=>b-a).forEach(i => table.splice(i, 1));
                table.push({ kanji: found, parts: combined });
                logs.push(`${players[myIndex].name}が「${found}」を和了！`);
                selectedHand.clear(); selectedTable.clear();
            } else { alert("役がありません"); return; }
        }
        await update(roomRef, { players, deck, table, turnIndex, hasDrawn, logs });
    }, { onlyOnce: true });
}
