import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, update } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";
const firebaseConfig = {
    apiKey: "AIzaSyB_awkpbzCSxtIGt4fKwcfyy2XmImkrv08",
    authDomain: "kanji-64bb5.firebaseapp.com",
    databaseURL: "https://kanji-64bb5-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "kanji-64bb5",
    storageBucket: "kanji-64bb5.firebasestorage.app",
    messagingSenderId: "583783676982",
    appId: "1:583783676982:web:f25957b9a38fb21c7a2c97"
};

// 初期化
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 他のファイル（各ゲーム）で使えるようにエクスポート
export { db, ref, set, onValue, push, update };
