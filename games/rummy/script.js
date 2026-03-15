import { db, ref, set, onValue, update } from '../../js/firebase-config.js';
// 実際のファイル構成に合わせて kanji_logic.js から判定用のデータをインポートする想定です
// import { KANJI_LOGIC_DATA } from './kanji_logic.js';

// --- たねのリストとグループ分け ---
const group1 = "口,木,艹,⺡,日,⺘,⺅,金,一,女,土,火,山,丶,言,丿,糹,⺖,田,大,十,⺮,心,宀,石,亠,貝".split(",");
const group2 = "禾,又,目,⺼,辶,厶,隹,⺉,力,攵,勹,人,車,疒,寸,米,广,冖,夂,⺨,儿,⻖,酉,頁,彳,几,囗".split(",");
const group3 = "尸,月,𠂉,厂,子,王,方,匕,白,斤,皿,䒑,灬,止,工,小,廾,夕,衣,𠂇,立,八,刀,匚,戈,巾,士".split(",");
const group4 = "虍,爫,冂,示,豆,門,耳,羽,兀,㔾,⻗,㐅,欠,丁,⺊,龷,糸,比,⺧,⺌,耂,戊,干,而,丂,户,魚,殳".split(",");

// --- ドローロジック ---
function drawRandomTane() {
    const rand = Math.random() * 100; // 0.0 〜 99.999...
    let targetGroup;

    if (rand < 30) {
        targetGroup = group1; // 30%
    } else if (rand < 57) {
        targetGroup = group2; // 27% (30 + 27)
    } else if (rand < 80) {
        targetGroup = group3; // 23% (57 + 23)
    } else {
        targetGroup = group4; // 20%
    }

    // 選ばれたグループからランダムに1つ選んで返す
    return targetGroup[Math.floor(Math.random() * targetGroup.length)];
}

// --- ユーザー・ルーム管理 ---
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myKanjiName') || "名無しさん";

window.addEventListener('DOMContentLoaded', () => {
    if (!roomId) {
        // ロビー画面の処理
        document.getElementById('lobby-ui').classList.remove('hidden');
        document.getElementById('lobby-my-name').innerText = myName;

        document.getElementById('save-name-btn').onclick = () => {
            const val = document.getElementById('name-input').value.trim();
            if (val) {
                myName = val;
                localStorage.setItem('myKanjiName', val);
                document.getElementById('lobby-my-name').innerText = val;
            }
        };

        // ルーム作成（設定値をFirebaseに保存）
        document.getElementById('create-room-btn').onclick = async () => {
            const newRoomId = Math.floor(100 + Math.random() * 900).toString();
            const initialHandSize = parseInt(document.getElementById('setting-hand-size').value, 10) || 10;
            const initialLife = parseInt(document.getElementById('setting-life').value, 10) || 3;

            await set(ref(db, `rooms/kanji-rummy/${newRoomId}/state`), { 
                status: "waiting", 
                hostId: myId,
                settings: {
                    handSize: initialHandSize,
                    life: initialLife
                }
            });
            window.location.href = `?room=${newRoomId}`;
        };

        document.getElementById('join-room-btn').onclick = () => {
            const inputId = document.getElementById('join-room-input').value.trim();
            if (inputId) window.location.href = `?room=${inputId}`;
        };
    } else {
        // ゲーム画面（待機）の処理
        document.getElementById('lobby-ui').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('display-room-id').innerText = roomId;

        // プレイヤー自身の名前を登録
        set(ref(db, `rooms/kanji-rummy/${roomId}/players/${myId}`), {
            name: myName
        });
        
        // --- 今後ここにゲーム開始（setupGame）やターン処理を追記していきます ---
    }
});
