// --- 画面構築とUIイベント (ui.js) ---

window.GraNotes = window.GraNotes || {};

GraNotes.UI = (function() {
    
    const ASSET_URL = 'https://namnam2727.github.io/GraNotes/';

    let selectedIndex = 0;
    let selectedDifficultyName = ""; 
    
    let previewAudio = new Audio();
    previewAudio.crossOrigin = "anonymous"; 
    
    let isPreviewAllowed = false; 
    let previewSource = null;
    let previewGain = null;
    
    const PREVIEW_MAX_VOLUME = 0.5;
    const FADE_DURATION = 2.0; 
    let previewAnimationFrame = null;

    let lastSysTime = 0;
    let smoothedAudioTime = 0;

    function build() {
        document.addEventListener('touchstart', function(event) {
            if (event.touches.length > 1) {
                event.preventDefault(); 
            }
        }, { passive: false });

        let lastTouchEnd = 0;
        document.addEventListener('touchend', function (event) {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, { passive: false });

        const app = document.getElementById('app');
        
        app.innerHTML = `
            <div id="game-container">
                <div id="screen-area">
                
                    <!-- タイトル（スプラッシュ）画面 -->
                    <div id="screen-splash" class="ui-layer" style="background: #020617; z-index: 50; cursor: pointer;">
                        <h1 class="text-5xl font-black text-teal-400 mb-8 tracking-widest" style="text-shadow: 0 0 20px rgba(45,212,191,0.6);">GraNotes</h1>
                        <p class="text-gray-300 text-lg animate-pulse font-bold tracking-widest">TAP TO START</p>
                    </div>

                    <!-- ミュージックセレクト画面 -->
                    <div id="screen-title" class="ui-layer" style="background: rgba(0,0,0,0.3); z-index: 20;">
                        <div id="select-bg"></div>
                        
                        <h1 class="text-3xl font-black text-teal-400 mt-2 mb-1 text-center tracking-wider z-10" style="text-shadow: 0 4px 10px rgba(0,0,0,0.9);">GraNotes</h1>
                        
                        <div class="flex-1 w-full flex items-center px-4 z-10 relative">
                            <div id="carousel-container" class="relative w-28 h-full flex justify-center items-center flex-shrink-0" style="touch-action: none; cursor: grab;">
                            </div>
                            <div class="ml-5 flex-1 flex flex-col justify-center" style="text-shadow: 0 2px 5px rgba(0,0,0,0.9);">
                                <h2 id="music-title" class="text-lg font-bold text-white mb-1 leading-tight"></h2>
                                <p id="music-bpm" class="text-sm text-teal-300 font-mono font-bold mb-2"></p>
                                <p id="music-desc" class="text-xs text-gray-200 leading-relaxed drop-shadow-md"></p>
                            </div>
                        </div>

                        <div id="loading-msg" class="text-teal-300 font-bold hidden z-10 mb-6 text-center text-sm bg-gray-900 bg-opacity-80 px-6 py-3 rounded-full border border-teal-500"></div>

                        <div id="diff-select" class="w-full flex flex-col items-center px-6 pb-6 z-10">
                            
                            <!-- ★ スライダーを上に押し上げ、タップ調整用のUIに改修 -->
                            <div id="offset-settings" class="w-full mb-3 relative z-20">
                                <div class="flex items-center justify-between mb-2 px-1">
                                    <div class="flex items-baseline space-x-2">
                                        <span class="text-sm text-gray-200 font-bold tracking-wider" style="text-shadow: 0 1px 2px rgba(0,0,0,0.8);">タイミング調整(遅延):</span>
                                        <span id="offset-val-display" class="text-teal-400 font-bold text-base font-mono leading-none" style="text-shadow: 0 1px 2px rgba(0,0,0,0.8);">0.10s</span>
                                    </div>
                                    <!-- ★ タップで自動調整できるプレビューキャンバス -->
                                    <div id="calibration-btn" class="relative w-10 h-10 rounded-full border-2 border-gray-500 overflow-hidden bg-black bg-opacity-60 cursor-pointer flex justify-center items-center transition-transform shadow-[0_0_8px_rgba(20,184,166,0.3)]">
                                        <canvas id="offset-preview-canvas" width="40" height="40" class="absolute top-0 left-0"></canvas>
                                        <span class="absolute text-[10px] font-black text-white opacity-60 pointer-events-none" style="text-shadow: 0 0 2px black;">TAP</span>
                                    </div>
                                </div>
                                <input type="range" id="offset-slider" min="0" max="0.30" step="0.01" value="0.10" class="w-full h-2 bg-gray-500 rounded-full appearance-none cursor-pointer accent-teal-400 border border-gray-800">
                            </div>

                            <!-- ★ 文字の再挿入 -->
                            <p class="text-sm text-gray-200 mb-2 font-bold" style="text-shadow: 0 2px 4px rgba(0,0,0,0.8);">難易度を選択してスタート</p>

                            <div id="diff-buttons" class="w-full flex flex-col space-y-2">
                                <!-- JSでボタンを生成 -->
                            </div>
                        </div>
                    </div>

                    <!-- ゲーム中HUD -->
                    <div id="hud-layer" class="hidden">
                        <button id="btn-retire">QUIT</button>
                        <div id="score-display">0000000</div>
                        <div id="center-display-area">
                            <div id="judge-display">PERFECT</div>
                            <div id="combo-display" style="display:none;">
                                <div class="combo-text"><span id="combo-count">0</span> COMBO</div>
                                <div id="combo-multiplier">(x1.00)</div>
                            </div>
                        </div>
                    </div>

                    <!-- リザルト画面 -->
                    <div id="screen-result" class="ui-layer hidden" style="background: rgba(15, 23, 42, 0.95); z-index: 30;">
                        <h2 class="text-3xl font-black text-white mb-2 mt-4">RESULT</h2>
                        
                        <div class="text-center mb-4 flex flex-col items-center">
                            <div id="res-music-image" class="w-28 h-28 rounded-2xl bg-cover bg-center mb-3 shadow-[0_0_15px_rgba(94,234,212,0.3)] border-2 border-teal-500/30"></div>
                            <div id="res-music-title" class="text-xl font-bold text-teal-300 px-4 leading-tight mb-1"></div>
                            <div id="res-music-diff" class="inline-block px-3 py-1 rounded-full text-xs font-bold bg-gray-800 text-gray-300 border border-gray-600"></div>
                        </div>

                        <div class="text-center mb-6">
                            <div class="text-gray-400 text-sm">SCORE</div>
                            <div id="result-score" class="text-5xl font-bold text-teal-400 tracking-wider">0000000</div>
                        </div>
                        <div class="w-3/4 space-y-2 mb-6 text-lg">
                            <div class="flex justify-between"><span class="text-yellow-400">PERFECT</span><span id="res-perfect">0</span></div>
                            <div class="flex justify-between"><span class="text-green-400">GOOD</span><span id="res-good">0</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">MISS</span><span id="res-miss">0</span></div>
                            <div class="flex justify-between border-t border-gray-600 pt-2 mt-2"><span class="text-teal-300">MAX COMBO</span><span id="res-combo">0</span></div>
                        </div>
                        <button id="btn-restart" class="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-full font-bold text-white transition-colors border border-gray-500 shadow-lg mb-4">選曲画面へ戻る</button>
                    </div>

                    <canvas id="game-canvas"></canvas>
                </div>
            </div>
        `;

        function adjustLayout() {
            const screenHeight = window.innerHeight;
            const topExclusionHeight = screenHeight >= 812 ? 98 : 74;
            document.documentElement.style.setProperty('--exclusion-height', topExclusionHeight + 'px');
        }
        window.addEventListener('resize', adjustLayout);
        adjustLayout(); 

        const diffSelect = document.getElementById('diff-buttons'); 
        const screenTitle = document.getElementById('screen-title');
        const screenResult = document.getElementById('screen-result');
        const btnRestart = document.getElementById('btn-restart');
        
        const slider = document.getElementById('offset-slider');
        const display = document.getElementById('offset-val-display');

        slider.value = GraNotes.Settings.noteOffset;
        display.textContent = GraNotes.Settings.noteOffset.toFixed(2) + 's';

        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            GraNotes.Settings.noteOffset = val;
            display.textContent = val.toFixed(2) + 's';
            localStorage.setItem('GraNotes_NoteOffset', val.toString());
        });

        // --- ★ 音に合わせてタップした際の自動キャリブレーション処理 ---
        const calibBtn = document.getElementById('calibration-btn');
        function handleCalibrationTap(e) {
            e.preventDefault();
            e.stopPropagation();
            if (!isPreviewAllowed || previewAudio.paused) return;
            const music = GraNotes.MusicList[selectedIndex];
            if (!music || !music.bpm) return;
            
            const beatDuration = 60 / music.bpm;
            const testInterval = beatDuration * 4; // 4拍ごとの基準
            
            // ユーザーが「音を聴いて叩いた」瞬間のオーディオ再生時間
            const tapTime = smoothedAudioTime;
            
            // 本来ノーツが降ってくるべき最も近い基準タイム（拍の頭）を計算
            const targetBeatTime = Math.round(tapTime / testInterval) * testInterval;
            
            // ズレ（遅延）を計算
            let newOffset = tapTime - targetBeatTime;
            
            // 指定範囲 (0.00s 〜 0.30s) に収める
            newOffset = Math.max(0, Math.min(0.30, newOffset));
            
            // 設定を更新して保存
            GraNotes.Settings.noteOffset = newOffset;
            slider.value = newOffset.toFixed(2);
            display.textContent = newOffset.toFixed(2) + 's';
            localStorage.setItem('GraNotes_NoteOffset', newOffset.toString());
            
            // タップが成功したことの視覚的フィードバック（ボタンが縮んで黄色く光る）
            calibBtn.style.transform = 'scale(0.8)';
            calibBtn.style.borderColor = '#fde047';
            setTimeout(() => { 
                calibBtn.style.transform = 'scale(1)'; 
                calibBtn.style.borderColor = '#6b7280';
            }, 150);
        }
        calibBtn.addEventListener('mousedown', handleCalibrationTap);
        calibBtn.addEventListener('touchstart', handleCalibrationTap, {passive: false});


        const carouselContainer = document.getElementById('carousel-container');
        GraNotes.MusicList.forEach((music, index) => {
            const item = document.createElement('div');
            item.id = `carousel-item-${index}`;
            item.className = 'carousel-item hidden-item'; 
            item.style.backgroundImage = `url('${ASSET_URL}music/${music.filename}.png')`;
            carouselContainer.appendChild(item);
        });
        
        const diffKeys = Object.keys(GraNotes.DIFFICULTIES);
        diffKeys.forEach(key => {
            const diff = GraNotes.DIFFICULTIES[key];
            const btn = document.createElement('button');
            btn.className = `btn-diff btn-${key}`;
            btn.textContent = diff.label;
            btn.onclick = () => startGameWithDifficulty(diff.value, diff.label);
            diffSelect.appendChild(btn);
        });

        GraNotes.Game.init(document.getElementById('game-canvas'));

        updateCarousel();
        setupCarouselEvents();

        const splashScreen = document.getElementById('screen-splash');
        splashScreen.addEventListener('click', async () => {
            if (!isPreviewAllowed) {
                const state = GraNotes.State;
                
                if (!state.audioContext) {
                    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
                if (state.audioContext.state === 'suspended') {
                    await state.audioContext.resume();
                }

                if (!previewSource) {
                    previewSource = state.audioContext.createMediaElementSource(previewAudio);
                    previewGain = state.audioContext.createGain();
                    previewSource.connect(previewGain);
                    previewGain.connect(state.audioContext.destination);
                }
                
                isPreviewAllowed = true;
                splashScreen.classList.add('hidden');
                playPreview();
            }
        });

        const btnRetire = document.getElementById('btn-retire');
        btnRetire.addEventListener('click', () => {
            GraNotes.Game.stopGame(true);
        });

        btnRestart.addEventListener('click', () => {
            screenResult.classList.add('hidden');
            screenTitle.classList.remove('hidden');
            document.getElementById('offset-settings').parentElement.classList.remove('hidden');
            document.getElementById('loading-msg').classList.add('hidden');
            updateCarousel(); 
        });

        lastSysTime = performance.now();
        drawOffsetPreview();
    }

    function drawOffsetPreview() {
        requestAnimationFrame(drawOffsetPreview);
        
        const canvas = document.getElementById('offset-preview-canvas');
        if (!canvas || !isPreviewAllowed || previewAudio.paused) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        const music = GraNotes.MusicList[selectedIndex];
        if (!music || !music.bpm) return;
        
        const offset = GraNotes.Settings.noteOffset;
        const beatDuration = 60 / music.bpm;
        const testInterval = beatDuration * 4; 
        
        const sysTime = performance.now();
        const dt = (sysTime - lastSysTime) / 1000.0;
        lastSysTime = sysTime;

        if (Math.abs(previewAudio.currentTime - smoothedAudioTime) > 0.1) {
            smoothedAudioTime = previewAudio.currentTime;
        } else {
            smoothedAudioTime += dt;
        }
        
        const audioTime = smoothedAudioTime;
        const gameTime = audioTime - offset;
        
        const currentBeat = Math.floor(gameTime / testInterval);
        const targetBeatTime = (currentBeat + 1) * testInterval;
        const timeToTarget = targetBeatTime - gameTime;
        
        const cx = width / 2;
        const cy = height / 2;
        const maxRadius = 10;
        const PRE_TIME = beatDuration * 1.5; 
        
        if (timeToTarget <= PRE_TIME && timeToTarget >= 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(20, 184, 166, 0.4)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx, cy, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
            
            const progress = 1.0 - (timeToTarget / PRE_TIME);
            const expandRadius = maxRadius + (maxRadius * 1.5 * (1 - progress));
            ctx.beginPath();
            ctx.arc(cx, cy, expandRadius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(20, 184, 166, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        
        const timeSinceLastBeat = gameTime - currentBeat * testInterval;
        if (timeSinceLastBeat >= 0 && timeSinceLastBeat < 0.2) {
            ctx.beginPath();
            ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(20, 184, 166, 0.8)';
            ctx.fill();

            const expand = 1.0 + (timeSinceLastBeat / 0.2);
            const fade = 1.0 - (timeSinceLastBeat / 0.2);
            ctx.beginPath();
            ctx.arc(cx, cy, maxRadius * expand, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(253, 224, 71, ${fade})`; 
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }

    function reportScore(finalScore) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'gameOver',
                score: finalScore
            }, '*');
            console.log("GRAVITYプラットフォームへスコア送信: " + finalScore);
        }
    }

    function playPreview() {
        if (!isPreviewAllowed) return; 
        
        const music = GraNotes.MusicList[selectedIndex];
        if (!music) return;

        if (previewAnimationFrame) {
            cancelAnimationFrame(previewAnimationFrame);
            previewAnimationFrame = null;
        }

        previewAudio.pause();
        previewAudio.volume = 0; 
        if (previewGain) previewGain.gain.value = 0;

        if (!previewAudio.src.endsWith(`${music.filename}.mp3`)) {
            previewAudio.src = `${ASSET_URL}music/${music.filename}.mp3`;
            previewAudio.load(); 
        }
        
        previewAudio.currentTime = music.previewStart;
        smoothedAudioTime = music.previewStart; 
        
        previewAudio.play().catch(e => console.log("プレビュー再生ブロック:", e));

        function updateVolumeLoop() {
            if (previewAudio.paused) return; 

            const current = previewAudio.currentTime;
            const start = music.previewStart;
            const end = music.previewEnd;

            if (current >= end) {
                previewAudio.currentTime = start;
                smoothedAudioTime = start; 
                if (previewGain) previewGain.gain.value = 0;
                else previewAudio.volume = 0;
            } else {
                let targetVolume = PREVIEW_MAX_VOLUME;
                if (current >= start && current < start + FADE_DURATION) {
                    let progress = (current - start) / FADE_DURATION;
                    targetVolume = Math.min(progress * PREVIEW_MAX_VOLUME, PREVIEW_MAX_VOLUME);
                } 
                else if (current <= end && current > end - FADE_DURATION) {
                    let progress = (end - current) / FADE_DURATION;
                    targetVolume = Math.max(progress * PREVIEW_MAX_VOLUME, 0);
                } 
                
                if (previewGain) {
                    previewGain.gain.value = targetVolume;
                } else {
                    previewAudio.volume = targetVolume; 
                }
            }
            previewAnimationFrame = requestAnimationFrame(updateVolumeLoop);
        }
        previewAnimationFrame = requestAnimationFrame(updateVolumeLoop);
    }

    function stopPreview() {
        previewAudio.pause();
        if (previewAnimationFrame) {
            cancelAnimationFrame(previewAnimationFrame);
            previewAnimationFrame = null;
        }
    }

    function updateCarousel() {
        const musicList = GraNotes.MusicList;
        if (!musicList || musicList.length === 0) return;
        
        const total = musicList.length;
        const prevIdx = (selectedIndex - 1 + total) % total;
        const nextIdx = (selectedIndex + 1) % total;
        
        for (let i = 0; i < total; i++) {
            const item = document.getElementById(`carousel-item-${i}`);
            if (!item) continue;
            
            item.className = 'carousel-item'; 
            if (i === selectedIndex) {
                item.classList.add('current');
            } else if (i === prevIdx) {
                item.classList.add('prev');
            } else if (i === nextIdx) {
                item.classList.add('next');
            } else {
                item.classList.add('hidden-item');
            }
        }
        
        document.getElementById('select-bg').style.backgroundImage = `url('${ASSET_URL}music/${musicList[selectedIndex].filename}.png')`;
        document.getElementById('music-title').textContent = musicList[selectedIndex].title;
        document.getElementById('music-bpm').textContent = `BPM: ${musicList[selectedIndex].bpm}`;
        document.getElementById('music-desc').textContent = musicList[selectedIndex].description;
        
        GraNotes.State.selectedMusicIndex = selectedIndex;

        if (isPreviewAllowed) {
            playPreview();
        }
    }

    function setupCarouselEvents() {
        const carousel = document.getElementById('carousel-container');
        let startY = 0;
        let isDragging = false;
        let hasSwiped = false; 
        const listLength = GraNotes.MusicList.length;

        function handleStart(y) {
            startY = y;
            isDragging = true;
            hasSwiped = false;
        }

        function handleMove(y) {
            if (!isDragging || hasSwiped) return;
            const diff = y - startY;
            
            if (diff > 40) { 
                selectedIndex = (selectedIndex - 1 + listLength) % listLength;
                updateCarousel();
                hasSwiped = true; 
            } else if (diff < -40) { 
                selectedIndex = (selectedIndex + 1) % listLength;
                updateCarousel();
                hasSwiped = true;
            }
        }

        function handleEnd() {
            isDragging = false;
        }

        carousel.addEventListener('mousedown', e => { handleStart(e.clientY); });
        window.addEventListener('mousemove', e => { handleMove(e.clientY); });
        window.addEventListener('mouseup', handleEnd);
        window.addEventListener('mouseleave', handleEnd);
        
        carousel.addEventListener('touchstart', e => { handleStart(e.touches[0].clientY); }, {passive: true});
        carousel.addEventListener('touchmove', e => { handleMove(e.touches[0].clientY); }, {passive: true});
        window.addEventListener('touchend', handleEnd);
        window.addEventListener('touchcancel', handleEnd);

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
            wheelTimeout = setTimeout(() => { wheelTimeout = null; }, 300); 
        }, {passive: true});
    }

    async function startGameWithDifficulty(minIntervalBeat, difficultyName) {
        selectedDifficultyName = difficultyName; 
        stopPreview();

        const loadingMsg = document.getElementById('loading-msg');
        const diffSelect = document.getElementById('diff-select').parentElement;
        
        diffSelect.classList.add('hidden');
        loadingMsg.classList.remove('hidden');
        loadingMsg.textContent = "楽曲データを取得中...";
        loadingMsg.style.color = "#5eead4"; 

        try {
            const state = GraNotes.State;
            const music = GraNotes.MusicList[selectedIndex];
            const manualBpm = music.bpm; 
            
            if (!state.audioContext) {
                state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (state.audioContext.state === 'suspended') {
                await state.audioContext.resume();
            }

            const response = await fetch(`${ASSET_URL}music/${music.filename}.mp3`);
            if (!response.ok) throw new Error("楽曲ファイルが見つかりません");
            const arrayBuffer = await response.arrayBuffer();
            
            loadingMsg.textContent = "音声をデコード中...";
            state.audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
            
            loadingMsg.textContent = "譜面を自動生成中...";
            setTimeout(async () => {
                try {
                    const maxSliderIntervalBeat = minIntervalBeat * 3.0; 
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
                        updateCarousel(); 
                    }, 3000);
                }
            }, 50);

        } catch (err) {
            console.error("楽曲ロードエラー:", err);
            loadingMsg.textContent = "エラー: " + err.message;
            loadingMsg.style.color = "#ef4444"; 
            
            setTimeout(() => {
                loadingMsg.classList.add('hidden');
                diffSelect.classList.remove('hidden');
                updateCarousel(); 
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
        const music = GraNotes.MusicList[selectedIndex]; 
        
        document.getElementById('hud-layer').classList.add('hidden');
        document.getElementById('screen-result').classList.remove('hidden');

        document.getElementById('res-music-image').style.backgroundImage = `url('${ASSET_URL}music/${music.filename}.png')`;
        document.getElementById('res-music-title').textContent = music.title;
        document.getElementById('res-music-diff').textContent = selectedDifficultyName;

        const finalScore = Math.floor(state.score);
        document.getElementById('result-score').textContent = finalScore;
        document.getElementById('res-perfect').textContent = state.stats.perfect;
        document.getElementById('res-good').textContent = state.stats.good;
        document.getElementById('res-miss').textContent = state.stats.miss;
        document.getElementById('res-combo').textContent = state.maxCombo;

        setTimeout(() => {
            reportScore(finalScore);
        }, 500);
    }

    window.GraNotesUI = {
        build: build,
        updateHUD: updateHUD,
        showJudge: showJudge,
        showResult: showResult
    };

    return window.GraNotesUI;
})();


