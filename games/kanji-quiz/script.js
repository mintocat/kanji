import { db, ref, set, onValue, update } from '../../js/firebase-config.js';

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

// IDと名前の管理
let myId = sessionStorage.getItem('myPlayerId') || Math.random().toString(36).substring(7);
sessionStorage.setItem('myPlayerId', myId);
let myName = localStorage.getItem('myKanjiName') || "名無しさん";

document.getElementById('display-room-id').innerText = roomId;
document.getElementById('display-my-name').innerText = myName;

let isHost = false;
let currentWord = "";
let shuffledStrokes = [];
let lastRenderedIndex = -1;
let nextStepTimer = null; // 5秒タイマー用

// --- 名前設定ロジック ---
document.getElementById('save-name-btn').onclick = () => {
    const val = document.getElementById('name-input').value.trim();
    if (val) {
        myName = val;
        localStorage.setItem('myKanjiName', val);
        document.getElementById('display-my-name').innerText = val;
        alert("名前を設定しました！");
    }
};

// --- 漢字データの取得 ---
async function getStrokes(char, charIndex) {
    const unicode = char.charCodeAt(0).toString(16).padStart(5, '0');
    const url = `https://cdn.jsdelivr.net/gh/kanjivg/kanjivg/kanji/${unicode}.svg`;
    try {
        const response = await fetch(url);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "image/svg+xml");
        return Array.from(doc.querySelectorAll('path')).map(p => ({
            d: p.getAttribute('d'),
            charIndex: charIndex
        }));
    } catch (e) { return []; }
}

async function setupNewGame() {
    const wordList = ["漢字", "学校", "先生", "学生", "大学", "授業", "教室", "試験", "答案", "成績", "勉強", "宿題", "図書", "図書室", "黒板", "机上", "椅子", "校庭", "体育", "音楽", "理科", "社会", "数学", "国語", "英語", "科学", "文化", "歴史", "世界", "社会", "国家", "政治", "経済", "法律", "政府", "市民", "国民", "平和", "戦争", "自由", "権利", "義務", "責任", "協力", "努力", "成功", "失敗", "経験", "成長", "発展", "進歩", "変化", "自然", "宇宙", "地球", "太陽", "月光", "星空", "海洋", "山川", "森林", "草原", "動物", "植物", "空気", "水道", "電気", "電話", "写真", "映画", "音声", "映像", "新聞", "雑誌", "放送", "情報", "通信", "交通", "道路", "鉄道", "新幹線", "駅前", "空港", "飛行", "旅行", "観光", "都市", "地方", "住宅", "建物", "会社", "企業", "仕事", "労働", "商売", "商品", "市場", "価格", "利益", "損失", "銀行", "通貨", "財政", "税金", "保険", "医療", "病院", "看護", "治療", "健康", "運動", "食事", "睡眠", "家族", "親子", "兄弟", "友人", "恋愛", "結婚", "人生", "未来", "現在", "過去", "時間", "瞬間", "一日", "一年", "毎日", "今日", "明日", "昨日", "今夜", "朝日", "夕日", "夜空", "朝食", "昼食", "夕食", "料理", "飲料", "果物", "野菜", "肉類", "魚類", "米飯", "食堂", "台所", "冷蔵庫", "電子", "電車", "地下鉄", "高速道", "交差点", "信号機", "歩行者", "自転車", "運転手", "乗客", "改札口", "発車", "到着", "停車", "空席", "満席", "切符", "定期券", "旅行者", "観光地", "名所", "温泉", "旅館", "宿泊", "観察", "研究", "発見", "発明", "実験", "分析", "理論", "仮説", "証明", "理解", "説明", "確認", "連絡", "報告", "発表", "計画", "実行", "判断", "決定", "管理", "指導", "教育者", "研究者", "科学者", "技術者", "経営者", "政治家", "芸術家", "作家", "画家", "音楽家", "俳優", "歌手", "映画館", "美術館", "博物館", "図書館", "体育館", "公園", "遊園地", "動物園", "植物園", "展覧会", "大会", "競技", "試合", "優勝", "敗北", "記録", "得点", "観客", "選手", "監督", "審判", "練習", "体力", "健康法", "運動会", "文化祭", "学園祭", "卒業式", "入学式", "始業式", "終業式", "表彰式", "発言", "会議", "討論", "意見", "提案", "反対", "賛成", "協議", "合意", "対話", "交渉", "契約", "条件", "規則", "大丈夫", "大成功", "大失敗", "大問題", "大事件", "大事故", "大発見", "大自然", "小学生", "中学生", "高校生", "大学生", "外国人", "日本人", "世界中", "全世界", "全人類", "一部分", "一時間", "長時間", "短時間", "大都市", "新世界", "旧世界", "大気圏", "新技術", "旧制度", "高速度", "低温度", "高温度", "大雨天", "強風雨", "小規模", "大規模", "新計画", "旧計画", "全体像", "部分図", "大変化", "大革命", "新社会", "旧社会", "全国家", "大経済", "大市場", "大企業", "小企業", "大成功例", "新記録", "容容漾漾", "一期一会", "一石二鳥", "一心同体", "一生懸命", "一目瞭然", "一刀両断", "異口同音", "温故知新", "起死回生", "試行錯誤", "自業自得", "自給自足", "自画自賛", "順風満帆", "十人十色", "千変万化", "前代未聞", "単刀直入", "電光石火", "天真爛漫", "日進月歩", "馬耳東風", "百発百中", "半信半疑", "臨機応変", "優柔不断", "意味深長", "焼肉定食", "危機一髪", "公明正大", "古今東西", "五里霧中", "四面楚歌", "弱肉強食", "正々堂々", "大同小異", "大器晩成", "朝三暮四", "東奔西走", "八方美人", "表裏一体", "本末転倒", "無我夢中", "勇往邁進", "用意周到", "和洋折衷", "因果応報", "以心伝心", "電光雷鳴", "風林火山", "森羅万象", "天地無用", "臨機応変", "完全無欠", "公私混同", "自信満々", "疑心暗鬼", "優勝劣敗", "千差万別", "意気投合", "危機管理", "事実無根", "自由自在", "迅速果断", "大胆不敵", "単純明快", "天衣無縫", "天下無敵", "東西南北", "南船北馬", "難攻不落", "二律背反", "白黒分明", "百花繚乱", "不言実行", "粉骨砕身", "満身創痍", "面目躍如", "無病息災", "有言実行"];
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
        playersGuessed: {} 
    });
}

// --- メイン監視ループ ---
onValue(ref(db, `rooms/kanji-quiz/${roomId}/state`), (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    isHost = (data.hostId === myId);
    currentWord = data.word;
    shuffledStrokes = data.strokes;

    const startBtn = document.getElementById('start-btn');
    const playUi = document.getElementById('play-ui');
    const resultUi = document.getElementById('result-ui');

    if (data.status === "waiting") {
        startBtn.classList.toggle('hidden', !isHost);
        playUi.classList.add('hidden');
        resultUi.classList.add('hidden');
        document.getElementById('announcement').innerText = isHost ? "参加者が揃ったら開始！" : "ホストを待機中...";
    } 
    else if (data.status === "playing") {
        startBtn.classList.add('hidden');
        playUi.classList.remove('hidden');
        resultUi.classList.add('hidden');
        updateCanvas(data);
    }

    if (data.lastGuess && data.lastGuess.user) {
        document.getElementById('announcement').innerText = `${data.lastGuess.user}さんの解答: ${data.lastGuess.text}`;
        if (data.lastGuess.correct) {
            setTimeout(() => showResult(data.lastGuess.user), 1000);
        }
    }

    // 【ホスト限定】自動進行ロジック
    if (isHost && data.status === "playing" && !data.lastGuess.correct) {
        manageTimer(data);
    }
});

function updateCanvas(data) {
    const stage = document.getElementById('kanji-stage');
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

    for (let i = lastRenderedIndex + 1; i <= data.currentIndex; i++) {
        const stroke = shuffledStrokes[i];
        if (!stroke) continue;
        const svg = document.getElementById(`svg-${stroke.charIndex}`);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", stroke.d);
        svg.appendChild(path);
        lastRenderedIndex = i;
    }
}

// --- 5秒タイマー管理 ---
function manageTimer(data) {
    const guessedCount = data.playersGuessed ? Object.keys(data.playersGuessed).length : 0;
    
    // タイマーが動いておらず、誰かが答えた、または5秒経過を待つ場合
    if (!nextStepTimer && guessedCount > 0) {
        nextStepTimer = setTimeout(() => {
            update(ref(db, `rooms/kanji-quiz/${roomId}/state`), {
                currentIndex: data.currentIndex + 1,
                playersGuessed: {}
            });
            nextStepTimer = null; // リセット
            document.getElementById('wait-msg').classList.add('hidden');
        }, 5000); // 5秒設定
    }
}

document.getElementById('submit-btn').onclick = () => {
    const input = document.getElementById('answer-input');
    const guess = input.value.trim();
    if (!guess) return;

    update(ref(db, `rooms/kanji-quiz/${roomId}/state/playersGuessed/${myId}`), true);
    update(ref(db, `rooms/kanji-quiz/${roomId}/state/lastGuess`), {
        user: myName,
        text: guess,
        correct: (guess === currentWord)
    });
    
    input.value = "";
    document.getElementById('wait-msg').classList.remove('hidden');
};

function showResult(winner) {
    document.getElementById('play-ui').classList.add('hidden');
    document.getElementById('result-ui').classList.remove('hidden');
    document.getElementById('winner-msg').innerText = `正解！勝者: ${winner}`;
    // 正解の熟語を大きく表示
    document.getElementById('correct-word-display').innerText = `正解は：${currentWord}`;
}

document.getElementById('start-btn').onclick = setupNewGame;
document.getElementById('next-game-btn').onclick = setupNewGame;
