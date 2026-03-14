import { db, ref, set, get } from './firebase-config.js';

export async function joinRoom(gameName, roomId) {
    if (!roomId) return alert("合言葉を入力してください");

    // 自分のプレイヤーIDを作成または取得（セッション中固定）
    let myPlayerId = sessionStorage.getItem('myPlayerId');
    if (!myPlayerId) {
        myPlayerId = Math.random().toString(36).substring(7);
        sessionStorage.setItem('myPlayerId', myPlayerId);
    }

    const roomRef = ref(db, `rooms/${gameName}/${roomId}/state`);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) {
        // ルームが存在しない場合：自分がホストとして作成
        await set(roomRef, {
            status: "waiting",
            hostId: myPlayerId, // ここでホストを固定
            createdAt: Date.now()
        });
    }

    window.location.href = `games/${gameName}/index.html?room=${roomId}`;
}
