const TANE_LIST = [
    "口","木","艹","⺡","日","⺘","⺅","金","一","女","土","火","山","丶","言","丿","糹","⺖","田","大","十","⺮","心","宀","石","亠","貝",
    "禾","又","目","⺼","辶","厶","隹","⺉","力","攵","勹","人","車","疒","寸","米","广","冖","夂","⺨","儿","⻖","酉","頁","彳","几","囗","尸","月",
    "𠂉","厂","子","王","方","匕","白","斤","皿","䒑","灬","止","工","小","廾","夕","衣","𠂇","立","八","刀","匚","戈","巾","士","虍","爫",
    "冂","示","豆","門","耳","羽","兀","㔾","⻗","㐅","欠","丁","⺊","龷","糸","比","⺧","⺌","耂","戊","干","而","丂","戸","魚","殳"
];


class KanjiRummy {
    constructor() {
        this.deck = [];
        this.hand = [];
        this.table = []; // {kanji: '明', parts: ['日', '月']}
        this.selectedHandIndices = new Set();
        this.selectedTableIndices = new Set();
        this.hasDrawn = false;
        
        this.init();
    }

    init() {
        this.buildDeck();
        // 最初の手札7枚
        for (let i = 0; i < 7; i++) this.hand.push(this.deck.pop());
        this.log("対局開始。手札を7枚配りました。");
        this.updateUI();
    }

    // 確率に基づいた山札生成
    buildDeck() {
        const counts = [11, 10, 8, 7]; // 前から27個ずつ、この枚数入れる
        TANE_LIST.forEach((tane, i) => {
            let groupIdx = Math.floor(i / 27);
            if (groupIdx > 3) groupIdx = 3;
            const count = counts[groupIdx];
            for (let j = 0; j < count; j++) this.deck.push(tane);
        });
        // シャッフル
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    draw() {
        if (this.hasDrawn) return;
        const card = this.deck.pop();
        this.hand.push(card);
        this.hasDrawn = true;
        this.log(`山札から「${card}」を引きました。`);
        this.updateUI();
    }

    discard() {
        if (!this.hasDrawn || this.selectedHandIndices.size !== 1) return;
        const idx = Array.from(this.selectedHandIndices)[0];
        const card = this.hand.splice(idx, 1)[0];
        this.log(`「${card}」を捨てて手番を終了しました。`);
        
        // ターンリセット
        this.hasDrawn = false;
        this.selectedHandIndices.clear();
        this.selectedTableIndices.clear();
        this.updateUI();
    }

    meld() {
        // 手札から選ばれた文字 ＋ 場から選ばれた漢字（もしあれば）を合算
        const tilesFromHand = Array.from(this.selectedHandIndices).map(i => this.hand[i]);
        const tilesFromTable = Array.from(this.selectedTableIndices).map(i => this.table[i].kanji);
        const combinedTiles = [...tilesFromHand, ...tilesFromTable];

        let foundKanji = null;
        for (const [kanji, patterns] of Object.entries(KANJI_LOGIC_DATA)) {
            for (const pattern of patterns) {
                if (this.isMatch(pattern, combinedTiles)) {
                    foundKanji = kanji;
                    break;
                }
            }
            if (foundKanji) break;
        }

        if (foundKanji) {
            this.log(`和了（ホーラ）！「${foundKanji}」が完成しました。`);
            // 消費
            const handIndices = Array.from(this.selectedHandIndices).sort((a,b)=>b-a);
            handIndices.forEach(i => this.hand.splice(i, 1));
            
            const tableIndices = Array.from(this.selectedTableIndices).sort((a,b)=>b-a);
            tableIndices.forEach(i => this.table.splice(i, 1));

            this.table.push({ kanji: foundKanji, parts: combinedTiles });
            this.selectedHandIndices.clear();
            this.selectedTableIndices.clear();
            this.updateUI();
        } else {
            alert("その組み合わせでは漢字になりません。");
        }
    }

    isMatch(p, s) {
        if (p.length !== s.length) return false;
        return [...p].sort().join('') === [...s].sort().join('');
    }

    updateUI() {
        const handEl = document.getElementById('hand-tiles');
        handEl.innerHTML = '';
        this.hand.forEach((tane, i) => {
            const div = document.createElement('div');
            div.className = `tile ${this.selectedHandIndices.has(i) ? 'selected' : ''}`;
            div.innerText = tane;
            div.onclick = () => this.toggleSelect('hand', i);
            handEl.appendChild(div);
        });

        const tableEl = document.getElementById('table-tiles');
        tableEl.innerHTML = '';
        this.table.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = `meld-box tile ${this.selectedTableIndices.has(i) ? 'selected' : ''}`;
            div.innerHTML = `<div class="meld-kanji">${item.kanji}</div><div class="meld-source">${item.parts.join('')}</div>`;
            div.onclick = () => this.toggleSelect('table', i);
            tableEl.appendChild(div);
        });

        document.getElementById('deck-count').innerText = `山札: ${this.deck.length} 枚`;
        document.getElementById('draw-btn').disabled = this.hasDrawn;
        document.getElementById('discard-btn').disabled = !this.hasDrawn || this.selectedHandIndices.size !== 1;
        document.getElementById('meld-btn').disabled = (this.selectedHandIndices.size + this.selectedTableIndices.size) < 2;
    }

    toggleSelect(type, i) {
        const set = (type === 'hand') ? this.selectedHandIndices : this.selectedTableIndices;
        if (set.has(i)) set.delete(i); else set.add(i);
        this.updateUI();
    }

    log(msg) {
        const logEl = document.getElementById('log');
        logEl.innerHTML = `<div>・ ${msg}</div>` + logEl.innerHTML;
    }
}

const game = new KanjiRummy();
