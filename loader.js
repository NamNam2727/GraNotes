(function() {
    // 開発中のローカル環境と、GitHub Pagesの本番環境を自動判別します
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
    // ★ URLをGraNotesに変更
    const baseURL = isLocal ? './' : 'https://namnam2727.github.io/GraNotes/';
    
    // 読み込むスクリプトのリスト（依存関係の順に並べる）
    const coreScripts = [
        'globals.js',   // 1. 変数や設定値
        'analyzer.js',  // 2. 音声解析と譜面生成
        'game.js',      // 3. ゲームループと判定処理
        'ui.js'         // 4. 画面構築とイベントリスナー
    ];

    // 非同期でスクリプトを順番に読み込む関数
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
            
            // 全スクリプト読み込み完了後、UIの構築処理をキックする
            if (typeof GraNotesUI !== 'undefined' && typeof GraNotesUI.build === 'function') {
                GraNotesUI.build();
            }
        } catch (error) {
            console.error("GraNotes Initialization Error:", error);
            document.getElementById('app').innerHTML = `<p style="color:red; text-align:center; margin-top:20px;">ゲームの読み込みに失敗しました。</p>`;
        }
    }

    // 將来GRAVITY SDKなどを挟む場合は、ここに初期化処理を追加します
    init();
})();


