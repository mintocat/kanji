import { db, ref, onValue } from '../../js/firebase-config.js';

export function initGame() {
    console.log("漢字大富豪が起動しました");
    
    // 例：データベースの 'games/daifugo' 階層を監視
    const gameRef = ref(db, 'games/daifugo/status');
    onValue(gameRef, (snapshot) => {
        const data = snapshot.val();
        document.getElementById('status').innerText = data ? `状態: ${data}` : "準備中";
    });
}
