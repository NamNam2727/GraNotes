(function() {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
    const baseURL = isLocal ? './' : 'https://namnam2727.github.io/GraNotes/';
    
    // ★ 新規作成した music.js を最初に読み込むように追加
    const coreScripts = [
        'music.js',     // 0. 音楽リストデータ
        'globals.js',   // 1. 変数や設定値
        'analyzer.js',  // 2. 音声解析と譜面生成
        'game.js',      // 3. ゲームループと判定処理
        'ui.js'         // 4. 画面構築とイベントリスナー
    ];

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = baseURL + src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    async function init() {
        try {
            console.log("Starting GraNotes initialization...");
            for (const src of coreScripts) {
                await loadScript(src);
                console.log(`Loaded: ${src}`);
            }
            console.log("All core scripts loaded. Ready to play!");
            
            if (typeof GraNotesUI !== 'undefined' && typeof GraNotesUI.build === 'function') {
                GraNotesUI.build();
            }
        } catch (error) {
            console.error("GraNotes Initialization Error:", error);
            document.getElementById('app').innerHTML = `<p style="color:red; text-align:center; margin-top:20px;">ゲームの読み込みに失敗しました。</p>`;
        }
    }

    init();
})();


