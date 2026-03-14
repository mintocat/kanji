import { db, ref, set, onValue } from './firebase-config.js';

/**
 * 指定したゲームとルームIDで参加・作成する
 * @param {string} gameName - 'daifugo' や 'poker'
 * @param {string} roomId - ユーザーが入力した合言葉
 */
export async function joinRoom(gameName, roomId) {
    if (!roomId) return alert("ルームIDを入力してください");

    const roomRef = ref(db, `rooms/${gameName}/${roomId}`);
    
    // ルームが存在するか確認（なければ初期データをセット）
    onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            set(roomRef, {
                status: "waiting",
                createdAt: Date.now(),
                players: {}
            });
        }
    }, { onlyOnce: true });

    // URLパラメータにルームIDを付けて遷移（例: game.html?room=123）
    window.location.href = `games/${gameName}/index.html?room=${roomId}`;
}
