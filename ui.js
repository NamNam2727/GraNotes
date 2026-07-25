// --- 画面構築とUIイベント (ui.js) ---

window.GraNotes = window.GraNotes || {};

GraNotes.UI = (function() {
    
    let selectedIndex = 0;

    function build() {
        const app = document.getElementById('app');
        
        // HTML構造の動的生成
        app.innerHTML = `
            <div id="game-container">
                <div id="screen-area">
                
                    <!-- タイトル & ミュージックセレクト画面 -->
                    <div id="screen-title" class="ui-layer" style="background: rgba(0,0,0,0.3);">
                        <div id="select-bg"></div>
                        
                        <h1 class="text-4xl font-black text-teal-400 mt-10 mb-2 text-center tracking-wider z-10" style="text-shadow: 0 4px 10px rgba(0,0,0,0.9);">GraNotes</h1>
                        
                        <!-- カルーセルと曲情報エリア -->
                        <div class="flex-1 w-full flex items-center px-4 z-10 relative">
                            <!-- 左側: カルーセル -->
                            <div id="carousel-container" class="relative w-32 h-full flex justify-center items-center flex-shrink-0" style="touch-action: none; cursor: grab;">
                                <div id="item-prev" class="carousel-item prev"></div>
                                <div id="item-current" class="carousel-item current"></div>
                                <div id="item-next" class="carousel-item next"></div>
                            </div>
                            <!-- 右側: 楽曲情報 -->
                            <div class="ml-6 flex-1 flex flex-col justify-center" style="text-shadow: 0 2px 5px rgba(0,0,0,0.9);">
                                <h2 id="music-title" class="text-xl font-bold text-white mb-1 leading-tight"></h2>
                                <p id="music-bpm" class="text-sm text-teal-300 font-mono font-bold mb-3"></p>
                                <p id="music-desc" class="text-xs text-gray-200 leading-relaxed drop-shadow-md"></p>
                            </div>
                        </div>

                        <div id="loading-msg" class="text-teal-300 font-bold hidden z-10 mb-6 text-center text-sm bg-gray-900 bg-opacity-80 px-6 py-3 rounded-full border border-teal-500"></div>

                        <div id="diff-select" class="w-full flex flex-col items-center px-8 pb-10 z-10">
                            <p class="text-sm text-gray-200 mb-3 font-bold" style="text-shadow: 0 2px 4px rgba(0,0,0,0.8);">難易度を選択してスタート</p>
                            <!-- 難易度ボタンはJavaScriptで動的生成します -->
                        </div>
                    </div>

                    <!-- ゲーム中HUD -->
                    <div id="hud-layer" class="hidden">
                        <div id="score-display">0000000</div>
                        
                        <!-- 判定文字とコンボをまとめた中央エリア -->
                        <div id="center-display-area">
                            <div id="judge-display">PERFECT</div>
                            <div id="combo-display" style="display:none;">
                                <div class="combo-text"><span id="combo-count">0</span> COMBO</div>
                                <div id="combo-multiplier">(x1.00)</div>
                            </div>
                        </div>
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
                        <button id="btn-restart" class="px-8 py-3 bg-gray-700 hover:bg-gray-600 rounded-full font-bold text-white transition-colors border border-gray-500">選曲画面へ戻る</button>
                    </div>

                    <canvas id="game-canvas"></canvas>
                </div>
            </div>
        `;

        // 要素の取得と初期化
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

        GraNotes.Game.init(document.getElementById('game-canvas'));

        // --- ★ カルーセルの初期化とスワイプ処理 ---
        updateCarousel();
        setupCarouselEvents();

        // リスタートボタン
        btnRestart.addEventListener('click', () => {
            screenResult.classList.add('hidden');
            screenTitle.classList.remove('hidden');
            document.getElementById('diff-select').classList.remove('hidden');
            document.getElementById('loading-msg').classList.add('hidden');
        });

        window.dispatchEvent(new Event('resize'));
    }

    // カルーセルの表示更新
    function updateCarousel() {
        const musicList = GraNotes.MusicList;
        if (!musicList || musicList.length === 0) return;
        
        const total = musicList.length;
        const prevIdx = (selectedIndex - 1 + total) % total;
        const nextIdx = (selectedIndex + 1) % total;
        
        // アルバムアート画像の設定
        document.getElementById('item-prev').style.backgroundImage = `url('music/${musicList[prevIdx].filename}.png')`;
        document.getElementById('item-current').style.backgroundImage = `url('music/${musicList[selectedIndex].filename}.png')`;
        document.getElementById('item-next').style.backgroundImage = `url('music/${musicList[nextIdx].filename}.png')`;
        
        // 背景画像の設定
        document.getElementById('select-bg').style.backgroundImage = `url('music/${musicList[selectedIndex].filename}.png')`;
        
        // テキストの設定
        document.getElementById('music-title').textContent = musicList[selectedIndex].title;
        document.getElementById('music-bpm').textContent = `BPM: ${musicList[selectedIndex].bpm}`;
        document.getElementById('music-desc').textContent = musicList[selectedIndex].description;
        
        // 選択された曲のインデックスを保存
        GraNotes.State.selectedMusicIndex = selectedIndex;
    }

    // カルーセルのスワイプ・ドラッグ・ホイールイベント登録
    function setupCarouselEvents() {
        const carousel = document.getElementById('carousel-container');
        let startY = 0;
        let isDragging = false;
        const listLength = GraNotes.MusicList.length;

        function handleMove(y) {
            if (!isDragging) return;
            const diff = y - startY;
            if (diff > 50) { // 下スワイプ -> 前の曲へ
                selectedIndex = (selectedIndex - 1 + listLength) % listLength;
                updateCarousel();
                isDragging = false;
            } else if (diff < -50) { // 上スワイプ -> 次の曲へ
                selectedIndex = (selectedIndex + 1) % listLength;
                updateCarousel();
                isDragging = false;
            }
        }

        // マウス
        carousel.addEventListener('mousedown', e => { startY = e.clientY; isDragging = true; });
        window.addEventListener('mousemove', e => { handleMove(e.clientY); });
        window.addEventListener('mouseup', () => { isDragging = false; });
        
        // タッチ
        carousel.addEventListener('touchstart', e => { startY = e.touches[0].clientY; isDragging = true; }, {passive: true});
        carousel.addEventListener('touchmove', e => { handleMove(e.touches[0].clientY); }, {passive: true});
        window.addEventListener('touchend', () => { isDragging = false; });
        window.addEventListener('touchcancel', () => { isDragging = false; });

        // マウスホイール
        let wheelTimeout;
        carousel.addEventListener('wheel', e => {
            if (wheelTimeout) return;
            if (e.deltaY > 0) {
                selectedIndex = (selectedIndex + 1) % listLength;
                updateCarousel();
            } else if (e.deltaY < 0) {
                selectedIndex = (selectedIndex - 1 + listLength) % listLength;
                updateCarousel();
            }
            wheelTimeout = setTimeout(() => { wheelTimeout = null; }, 300); // 連続発動防止
        }, {passive: true});
    }

    // 指定されたURLからMP3ファイルを読み込む
    async function fetchMusicBuffer(filename) {
        const response = await fetch(`music/${filename}.mp3`);
        if (!response.ok) throw new Error("楽曲ファイルが見つかりません: " + filename);
        return await response.arrayBuffer();
    }

    async function startGameWithDifficulty(minIntervalBeat) {
        const loadingMsg = document.getElementById('loading-msg');
        const diffSelect = document.getElementById('diff-select');
        
        diffSelect.classList.add('hidden');
        loadingMsg.classList.remove('hidden');
        loadingMsg.textContent = "楽曲データを取得中...";
        loadingMsg.style.color = "#5eead4"; 

        try {
            const state = GraNotes.State;
            const music = GraNotes.MusicList[selectedIndex];
            const manualBpm = music.bpm; // 音楽リストに登録されたBPMを使用
            
            // AudioContextの初期化と再開処理 (ブラウザの自動再生ポリシー対応)
            if (!state.audioContext) {
                state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (state.audioContext.state === 'suspended') {
                await state.audioContext.resume();
            }

            // MP3データの取得
            const arrayBuffer = await fetchMusicBuffer(music.filename);
            
            loadingMsg.textContent = "音声をデコード中...";
            state.audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
            
            loadingMsg.textContent = "譜面を自動生成中...";
            setTimeout(async () => {
                try {
                    const maxSliderIntervalBeat = minIntervalBeat * 3.0; 
                    // 解析エンジンに登録されたBPMを渡して譜面生成
                    await GraNotes.Analyzer.generateMap(state.audioBuffer, minIntervalBeat, maxSliderIntervalBeat, manualBpm);
                    
                    document.getElementById('screen-title').classList.add('hidden');
                    document.getElementById('hud-layer').classList.remove('hidden');
                    GraNotes.Game.startGame();
                } catch (err) {
                    console.error("生成中にエラーが発生しました:", err);
                    loadingMsg.textContent = "解析エラー: " + err.message;
                    loadingMsg.style.color = "#ef4444"; 
                    
                    setTimeout(() => {
                        loadingMsg.classList.add('hidden');
                        diffSelect.classList.remove('hidden');
                    }, 3000);
                }
            }, 50);

        } catch (err) {
            console.error("楽曲ロードエラー:", err);
            loadingMsg.textContent = err.message;
            loadingMsg.style.color = "#ef4444"; 
            
            setTimeout(() => {
                loadingMsg.classList.add('hidden');
                diffSelect.classList.remove('hidden');
            }, 3000);
        }
    }

    function updateHUD() {
        const state = GraNotes.State;
        document.getElementById('score-display').textContent = String(Math.floor(state.score)).padStart(7, '0');
        
        const elCombo = document.getElementById('combo-display');
        const elMultiplier = document.getElementById('combo-multiplier');
        
        if (state.combo >= 1) { 
            elCombo.style.display = 'flex';
            document.getElementById('combo-count').textContent = state.combo;
            
            const multiplier = (1.0 + (state.combo * 0.01)).toFixed(2);
            if (elMultiplier) elMultiplier.textContent = `(x${multiplier})`;

            elCombo.classList.remove('combo-high', 'combo-fever');
            if (state.combo >= 100) {
                elCombo.classList.add('combo-fever');
            } else if (state.combo >= 50) {
                elCombo.classList.add('combo-high');
            }
        } else {
            elCombo.style.display = 'none';
            elCombo.classList.remove('combo-high', 'combo-fever');
        }
    }

    function showJudge(text, color) {
        const elJudge = document.getElementById('judge-display');
        const elCenterArea = document.getElementById('center-display-area'); 

        elJudge.textContent = text;
        elJudge.style.color = color;

        elCenterArea.classList.remove('judge-pop');
        void elCenterArea.offsetWidth; 
        elCenterArea.classList.add('judge-pop');
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

    window.GraNotesUI = {
        build: build,
        updateHUD: updateHUD,
        showJudge: showJudge,
        showResult: showResult
    };

    return window.GraNotesUI;
})();


