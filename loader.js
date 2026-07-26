(function() {
    // ★ どんな環境から呼ばれても、必ずGitHub Pagesからファイルを取得するように絶対パス固定
    const baseURL = 'https://namnam2727.github.io/GraNotes/';
    
    const coreScripts = [
        'music.js',     
        'globals.js',   
        'analyzer.js',  
        'game.js',      
        'ui.js'         
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


