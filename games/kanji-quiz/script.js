// 漢字をUnicode(16進数)に変換する関数
function getUnicode(char) {
    return char.charCodeAt(0).toString(16).padStart(5, '0');
}

// 1つの漢字の「画(path)」データを取得する
async function getStrokes(char) {
    const unicode = getUnicode(char);
    const url = `https://cdn.jsdelivr.net/gh/kanjivg/kanjivg/kanji/${unicode}.svg`;
    
    const response = await fetch(url);
    const text = await response.text();
    
    // SVG文字列を解析してpathタグのd属性だけ抜き出す
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "image/svg+xml");
    const paths = Array.from(doc.querySelectorAll('path'));
    return paths.map(p => p.getAttribute('d'));
}

async function startQuiz(word) {
    const svgArea = document.getElementById('quiz-svg');
    svgArea.innerHTML = ''; // 画面クリア
    document.getElementById('message').innerText = "この熟語は何だ？";

    let allStrokes = [];

    // 熟語の全漢字から画データを集める
    for (let char of word) {
        const strokes = await getStrokes(char);
        allStrokes = allStrokes.concat(strokes);
    }

    // 画の順番をシャッフル（ここがクイズの肝！）
    allStrokes.sort(() => Math.random() - 0.5);

    // 1画ずつ表示するタイマー
    let count = 0;
    const interval = setInterval(() => {
        if (count >= allStrokes.length) {
            clearInterval(interval);
            document.getElementById('message').innerText = "終了！正解は " + word;
            return;
        }

        // 新しいpath要素を作ってSVGに追加
        const newPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        newPath.setAttribute("d", allStrokes[count]);
        svgArea.appendChild(newPath);

        count++;
    }, 1000); // 1秒ごとに1画表示
}

// ボタンイベント
document.getElementById('start-btn').onclick = () => {
    // テストとして「漢字」という熟語で開始
    startQuiz("漢字");
};
