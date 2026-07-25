// --- 画面構築とUIイベント (ui.js) ---

window.GraNotes = window.GraNotes || {};

GraNotes.UI = (function() {
    
    function build() {
        const app = document.getElementById('app');
        
        // HTML構造の動的生成
        app.innerHTML = `
            <div id="game-container">
                <div id="screen-area">
                
                    <!-- タイトル画面 -->
                    <div id="screen-title" class="ui-layer">
                        <h1 class="text-4xl font-black text-teal-400 mb-2 text-center tracking-wider">GraNotes</h1>
                        <p class="text-gray-400 text-sm mb-10 text-center">自動譜面生成リズムゲーム</p>
                        
                        <div id="file-selector-area" class="w-4/5 bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-xl mb-6">
                            <label class="block text-sm font-medium text-teal-300 mb-2 text-center">遊ぶ楽曲（MP4/MP3）を選択</label>
                            <input type="file" id="audio-file" accept="audio/*,video/mp4" class="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:font-semibold file:bg-teal-600 file:text-white hover:file:bg-teal-500 cursor-pointer" />
                        </div>

                        <div id="loading-msg" class="text-teal-300 font-bold hidden"></div>

                        <div id="diff-select" class="w-full flex flex-col items-center hidden">
                            <p class="text-sm text-gray-300 mb-2">難易度を選択してスタート</p>
                            <!-- 難易度ボタンはJavaScriptで動的生成します -->
                        </div>
                    </div>

                    <!-- ゲーム中HUD -->
                    <div id="hud-layer" class="hidden">
                        <div id="score-display">0000000</div>
                        <div id="combo-display" style="display:none;"><span id="combo-count">0</span> COMBO</div>
                        <div id="judge-display">PERFECT</div>
                    </div>

                    <!-- リザルト画面 -->
                    <div id="screen-result" class="ui-layer hidden">
                        <h2 class="text-3xl font-black text-white mb-6">RESULT</h2>
                        <div class="text-center mb-8">
                            <div class="text-gray-400 text-sm">SCORE</div>
                            <div id="result-score" class="text-5xl font-bold text-teal-400 tracking-wider">0000000</div>
                        </div>
                        <div class="w-3/4 space-y-2 mb-8 text-lg">
                            <div class="flex justify-between"><span class="text-yellow-400">PERFECT</span><span id="res-perfect">0</span></div>
                            <div class="flex justify-between"><span class="text-green-400">GOOD</span><span id="res-good">0</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">MISS</span><span id="res-miss">0</span></div>
                            <div class="flex justify-between border-t border-gray-600 pt-2 mt-2"><span class="text-teal-300">MAX COMBO</span><span id="res-combo">0</span></div>
                        </div>
                        <button id="btn-restart" class="px-8 py-3 bg-gray-700 hover:bg-gray-600 rounded-full font-bold text-white transition-colors border border-gray-500">タイトルへ戻る</button>
                    </div>

                    <!-- キャンバス -->
                    <canvas id="game-canvas"></canvas>
                </div>
            </div>
        `;

        // 要素の取得
        const fileInput = document.getElementById('audio-file');
        const loadingMsg = document.getElementById('loading-msg');
        const diffSelect = document.getElementById('diff-select');
        const screenTitle = document.getElementById('screen-title');
        const screenResult = document.getElementById('screen-result');
        const btnRestart = document.getElementById('btn-restart');
        
        // 難易度ボタンの動的生成
        const diffKeys = Object.keys(GraNotes.DIFFICULTIES);
        diffKeys.forEach(key => {
            const diff = GraNotes.DIFFICULTIES[key];
            const btn = document.createElement('button');
            btn.className = `btn-diff btn-${key}`;
            btn.textContent = diff.label;
            btn.onclick = () => startGameWithDifficulty(diff.value);
            diffSelect.appendChild(btn);
        });

        // ゲーム初期化
        GraNotes.Game.init(document.getElementById('game-canvas'));

        // ファイル選択イベント
        fileInput.addEventListener('change', async (e) => {
            if (!e.target.files[0]) return;
            diffSelect.classList.add('hidden');
            loadingMsg.classList.remove('hidden');
            loadingMsg.textContent = "音声をデコード中...";
            
            try {
                const arrayBuffer = await e.target.files[0].arrayBuffer();
                const state = GraNotes.State;
                if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                state.audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
                
                loadingMsg.classList.add('hidden');
                diffSelect.classList.remove('hidden');
            } catch (err) {
                loadingMsg.textContent = "エラー: " + err.message;
            }
        });

        // リスタートボタン
        btnRestart.addEventListener('click', () => {
            screenResult.classList.add('hidden');
            screenTitle.classList.remove('hidden');
            document.getElementById('file-selector-area').classList.remove('hidden');
            fileInput.value = ''; 
        });

        // リサイズ時のキャンバス調整
        window.dispatchEvent(new Event('resize'));
    }

    async function startGameWithDifficulty(minIntervalBeat) {
        const loadingMsg = document.getElementById('loading-msg');
        document.getElementById('diff-select').classList.add('hidden');
        document.getElementById('file-selector-area').classList.add('hidden');
        loadingMsg.classList.remove('hidden');
        loadingMsg.textContent = "譜面を自動生成中...";

        // UI描画を更新させるため少し待つ
        setTimeout(async () => {
            // 結合間隔はルール通り最小間隔の3倍
            const maxSliderIntervalBeat = minIntervalBeat * 3.0; 
            await GraNotes.Analyzer.generateMap(GraNotes.State.audioBuffer, minIntervalBeat, maxSliderIntervalBeat);
            
            document.getElementById('screen-title').classList.add('hidden');
            document.getElementById('hud-layer').classList.remove('hidden');
            GraNotes.Game.startGame();
        }, 50);
    }

    // --- HUD更新と判定表示 (Game.jsから呼ばれる) ---
    function updateHUD() {
        const state = GraNotes.State;
        document.getElementById('score-display').textContent = String(Math.floor(state.score)).padStart(7, '0');
        
        const elCombo = document.getElementById('combo-display');
        if (state.combo > 4) {
            elCombo.style.display = 'block';
            document.getElementById('combo-count').textContent = state.combo;
        } else {
            elCombo.style.display = 'none';
        }
    }

    function showJudge(text, color) {
        const elJudge = document.getElementById('judge-display');
        elJudge.textContent = text;
        elJudge.style.color = color;
        elJudge.classList.remove('judge-pop');
        void elJudge.offsetWidth; // リフロー強制でアニメーション再起動
        elJudge.classList.add('judge-pop');
    }

    function showResult() {
        const state = GraNotes.State;
        document.getElementById('hud-layer').classList.add('hidden');
        document.getElementById('screen-result').classList.remove('hidden');

        document.getElementById('result-score').textContent = Math.floor(state.score);
        document.getElementById('res-perfect').textContent = state.stats.perfect;
        document.getElementById('res-good').textContent = state.stats.good;
        document.getElementById('res-miss').textContent = state.stats.miss;
        document.getElementById('res-combo').textContent = state.maxCombo;
    }

    // 他ファイルから呼べるようにエクスポート
    window.GraNotesUI = {
        build: build,
        updateHUD: updateHUD,
        showJudge: showJudge,
        showResult: showResult
    };

    return window.GraNotesUI;
})();


