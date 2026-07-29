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

    let currentCustomAudioUrl = '';
    let currentCustomFileName = '';

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

        if (!GraNotes.MusicList.find(m => m.isCustom)) {
            GraNotes.MusicList.push({
                title: "カスタム楽曲",
                filename: "custom",
                bpm: null,
                previewStart: 0,
                previewEnd: 0,
                description: "",
                isCustom: true
            });
        }

        const app = document.getElementById('app');
        
        app.innerHTML = `
            <div id="game-container">
                <div id="screen-area">
                
                    <div id="screen-splash" class="ui-layer" style="background: #020617; z-index: 50; cursor: pointer;">
                        <h1 class="text-5xl font-black text-teal-400 mb-8 tracking-widest" style="text-shadow: 0 0 20px rgba(45,212,191,0.6);">GraNotes</h1>
                        <p class="text-gray-300 text-lg animate-pulse font-bold tracking-widest">TAP TO START</p>
                    </div>

                    <div id="screen-title" class="ui-layer" style="background: rgba(0,0,0,0.3); z-index: 20;">
                        <div id="select-bg"></div>
                        
                        <h1 class="text-3xl font-black text-teal-400 mt-2 mb-1 text-center tracking-wider z-10" style="text-shadow: 0 4px 10px rgba(0,0,0,0.9);">GraNotes</h1>
                        
                        <div class="flex-1 w-full flex items-center px-4 z-10 relative">
                            <div id="carousel-container" class="relative w-28 h-full flex justify-center items-center flex-shrink-0" style="touch-action: none; cursor: grab;">
                            </div>
                            <!-- ★ min-w-0 を追加して、親コンテナが押し広げられるのを防ぎます -->
                            <div class="ml-5 flex-1 flex flex-col justify-center min-w-0" style="text-shadow: 0 2px 5px rgba(0,0,0,0.9);">
                                <!-- ★ h2 に truncate を追加し、長いタイトルも省略します -->
                                <h2 id="music-title" class="text-lg font-bold text-white mb-1 leading-tight truncate"></h2>
                                <p id="music-bpm" class="text-sm text-teal-300 font-mono font-bold mb-2"></p>
                                <div id="music-desc" class="text-xs text-gray-200 leading-relaxed drop-shadow-md max-h-24 overflow-y-auto"></div>
                                
                                <!-- ★ カスタム楽曲入力フォーム -->
                                <div id="custom-input-area" class="hidden flex-col w-full mt-1 space-y-3">
                                    <div class="text-[10px] text-teal-300 font-bold" style="text-shadow: 0 1px 2px rgba(0,0,0,0.8);">mp3 または mp4 を選択してください</div>
                                    
                                    <div class="flex items-center space-x-2">
                                        <!-- ★ ボタンが潰れないように flex-shrink-0 を追加 -->
                                        <button id="custom-file-btn" class="bg-gray-700 hover:bg-gray-600 text-gray-200 text-[11px] px-3 py-2 rounded border border-gray-500 whitespace-nowrap shadow pointer-events-auto flex-shrink-0">端末から選択</button>
                                        <input type="file" id="custom-file-input" accept=".mp3,audio/mpeg,audio/mp3,.mp4,video/mp4,audio/*,video/*" class="hidden">
                                        <!-- ★ min-w-0 を追加して truncate を正常に機能させます -->
                                        <span id="custom-file-name" class="text-[11px] text-gray-300 truncate flex-1 pointer-events-auto font-bold min-w-0" style="text-shadow: 0 1px 2px rgba(0,0,0,0.8);">未選択</span>
                                    </div>

                                    <div class="flex flex-col space-y-1 w-full">
                                        <div class="flex items-center space-x-2">
                                            <!-- ★ min-w-0 を追加 -->
                                            <input type="number" id="custom-bpm" placeholder="BPM (空欄で自動検出)" class="bg-gray-800 text-white text-[11px] p-2 rounded border border-gray-600 focus:border-teal-400 outline-none flex-1 shadow-inner pointer-events-auto min-w-0">
                                            <!-- ★ flex-shrink-0 を追加 -->
                                            <button id="btn-custom-preview" class="bg-teal-600 hover:bg-teal-500 text-white text-[11px] px-4 py-2 rounded font-bold whitespace-nowrap shadow pointer-events-auto flex-shrink-0">▶ プレビュー</button>
                                        </div>
                                        <!-- ★ テキストを左揃え(text-left)にして、BPM欄の真下に配置します -->
                                        <div id="custom-bpm-estimate" class="text-[10px] text-teal-300 font-bold hidden cursor-pointer hover:text-white transition-colors pointer-events-auto text-left pl-1" style="text-shadow: 0 1px 2px rgba(0,0,0,0.8);">推定BPM: 解析中...</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div id="loading-msg" class="text-teal-300 font-bold hidden z-10 mb-6 text-center text-sm bg-gray-900 bg-opacity-80 px-6 py-3 rounded-full border border-teal-500"></div>

                        <div id="diff-select" class="w-full flex flex-col items-center px-6 pb-6 z-10">
                            
                            <div id="offset-settings" class="w-full mb-3 relative z-20">
                                <div class="flex items-center justify-between mb-2 px-1">
                                    <div class="flex items-baseline space-x-2">
                                        <span class="text-sm text-gray-200 font-bold tracking-wider" style="text-shadow: 0 1px 2px rgba(0,0,0,0.8);">タイミング調整(遅延):</span>
                                        <span id="offset-val-display" class="text-teal-400 font-bold text-base font-mono leading-none" style="text-shadow: 0 1px 2px rgba(0,0,0,0.8);">0.10s</span>
                                    </div>
                                    <div id="calibration-btn" class="relative w-10 h-10 rounded-full border-2 border-gray-500 overflow-hidden bg-black bg-opacity-60 cursor-pointer flex justify-center items-center transition-transform shadow-[0_0_8px_rgba(20,184,166,0.3)]">
                                        <canvas id="offset-preview-canvas" width="40" height="40" class="absolute top-0 left-0"></canvas>
                                        <span class="absolute text-[10px] font-black text-white opacity-60 pointer-events-none" style="text-shadow: 0 0 2px black;">TAP</span>
                                    </div>
                                </div>
                                <input type="range" id="offset-slider" min="0" max="0.30" step="0.01" value="0.10" class="w-full h-2 bg-gray-500 rounded-full appearance-none cursor-pointer accent-teal-400 border border-gray-800 pointer-events-auto">
                            </div>

                            <p class="text-sm text-gray-200 mb-2 font-bold" style="text-shadow: 0 2px 4px rgba(0,0,0,0.8);">難易度を選択してスタート</p>

                            <div id="diff-buttons" class="w-full flex flex-col space-y-2 pointer-events-auto">
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
                            <div id="res-music-image" class="w-28 h-28 rounded-2xl bg-cover bg-center mb-3 shadow-[0_0_15px_rgba(94,234,212,0.3)] border-2 border-teal-500/30 overflow-hidden relative"></div>
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
                        <button id="btn-restart" class="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-full font-bold text-white transition-colors border border-gray-500 shadow-lg mb-4 pointer-events-auto">選曲画面へ戻る</button>
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

        const fileInput = document.getElementById('custom-file-input');
        const btnFile = document.getElementById('custom-file-btn');
        const fileNameDisplay = document.getElementById('custom-file-name');
        const bpmInput = document.getElementById('custom-bpm');
        const btnPreview = document.getElementById('btn-custom-preview');

        bpmInput.value = localStorage.getItem('GraNotes_CustomBpm') || '';

        btnFile.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                if (currentCustomAudioUrl) {
                    URL.revokeObjectURL(currentCustomAudioUrl);
                }
                currentCustomAudioUrl = URL.createObjectURL(file);
                currentCustomFileName = file.name;
                fileNameDisplay.textContent = file.name;
            }
        });

        bpmInput.addEventListener('input', (e) => {
            localStorage.setItem('GraNotes_CustomBpm', e.target.value);
        });

        // ★ プレビューボタン押下時に非同期でBPM解析を実行
        btnPreview.addEventListener('click', async () => {
            if (currentCustomAudioUrl) {
                playPreview(); // 音声再生はそのまま即開始
                
                const estimateEl = document.getElementById('custom-bpm-estimate');
                if (estimateEl) {
                    estimateEl.classList.remove('hidden');
                    estimateEl.textContent = '推定BPM: 解析中...';
                    
                    try {
                        const state = GraNotes.State;
                        if (!state.audioContext) {
                            state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                        }
                        if (state.audioContext.state === 'suspended') {
                            await state.audioContext.resume();
                        }

                        // プレビューと同時に音声をfetchしてデコードし、キャッシュに保存
                        let audioBuffer = state.audioBuffer;
                        if (!audioBuffer || state.currentAudioUrl !== currentCustomAudioUrl) {
                            const response = await fetch(currentCustomAudioUrl);
                            const arrayBuffer = await response.arrayBuffer();
                            audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
                            state.audioBuffer = audioBuffer;
                            state.currentAudioUrl = currentCustomAudioUrl;
                        }

                        // Analyzer側の関数を呼び出してBPMを推定
                        if(GraNotes.Analyzer && GraNotes.Analyzer.estimateBPM) {
                            const bpm = await GraNotes.Analyzer.estimateBPM(audioBuffer);
                            estimateEl.textContent = `推定BPM: ${bpm} (タップして反映)`;
                            
                            // テキストをタップすると入力欄に自動反映
                            estimateEl.onclick = () => {
                                bpmInput.value = bpm;
                                localStorage.setItem('GraNotes_CustomBpm', bpm);
                                estimateEl.textContent = `反映しました: ${bpm}`;
                                setTimeout(() => {
                                    estimateEl.textContent = `推定BPM: ${bpm} (タップして反映)`;
                                }, 1500);
                            };
                        } else {
                            estimateEl.textContent = '推定BPM: 機能未実装';
                        }
                    } catch (err) {
                        console.error(err);
                        estimateEl.textContent = '推定BPM: 解析失敗';
                    }
                }
            } else {
                showMessage("楽曲ファイルを選択してください", true);
            }
        });

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

        const calibBtn = document.getElementById('calibration-btn');
        function handleCalibrationTap(e) {
            e.preventDefault();
            e.stopPropagation();
            if (!isPreviewAllowed || previewAudio.paused) return;
            const music = GraNotes.MusicList[selectedIndex];
            
            let bpm = music.bpm;
            if (music.isCustom) {
                bpm = parseFloat(document.getElementById('custom-bpm').value);
            }
            if (!bpm || bpm <= 0) return; 
            
            const beatDuration = 60 / bpm;
            const testInterval = beatDuration * 4; 
            
            const tapTime = smoothedAudioTime;
            const targetBeatTime = Math.round(tapTime / testInterval) * testInterval;
            let newOffset = tapTime - targetBeatTime;
            
            newOffset = Math.max(0, Math.min(0.30, newOffset));
            
            GraNotes.Settings.noteOffset = newOffset;
            slider.value = newOffset.toFixed(2);
            display.textContent = newOffset.toFixed(2) + 's';
            localStorage.setItem('GraNotes_NoteOffset', newOffset.toString());
            
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
            
            if (music.isCustom) {
                item.style.backgroundImage = `linear-gradient(135deg, #334155, #0f172a)`;
                item.innerHTML = `
                    <div class="w-full h-full flex flex-col justify-center items-center text-gray-400">
                        <svg class="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
                        </svg>
                        <span class="text-xs font-bold tracking-wider">LOCAL</span>
                    </div>`;
            } else {
                item.style.backgroundImage = `url('${ASSET_URL}music/${music.filename}.png')`;
            }
            
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

    function showMessage(msg, isError = false) {
        const msgEl = document.getElementById('loading-msg');
        msgEl.textContent = msg;
        msgEl.style.color = isError ? "#ef4444" : "#5eead4";
        msgEl.classList.remove('hidden');
        setTimeout(() => msgEl.classList.add('hidden'), 3000);
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
        
        let bpm = music.bpm;
        if (music.isCustom) {
            bpm = parseFloat(document.getElementById('custom-bpm').value);
        }
        if (!bpm || bpm <= 0) return;
        
        const offset = GraNotes.Settings.noteOffset;
        const beatDuration = 60 / bpm;
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

        let audioUrl = `${ASSET_URL}music/${music.filename}.mp3`;
        let pStart = music.previewStart;
        let pEnd = music.previewEnd;

        if (music.isCustom) {
            if (!currentCustomAudioUrl) {
                stopPreview();
                return;
            }
            audioUrl = currentCustomAudioUrl;
            pStart = 0;       
            pEnd = 999999;    
        }

        if (previewAnimationFrame) {
            cancelAnimationFrame(previewAnimationFrame);
            previewAnimationFrame = null;
        }

        previewAudio.pause();
        previewAudio.volume = 0; 
        if (previewGain) previewGain.gain.value = 0;

        if (previewAudio.dataset.currentSrc !== audioUrl) {
            previewAudio.src = audioUrl;
            previewAudio.dataset.currentSrc = audioUrl;
            previewAudio.load(); 
        }
        
        previewAudio.currentTime = pStart;
        smoothedAudioTime = pStart; 
        
        previewAudio.play().catch(e => console.log("プレビュー再生ブロック:", e));

        function updateVolumeLoop() {
            if (previewAudio.paused) return; 

            const current = previewAudio.currentTime;

            if (current >= pEnd) {
                previewAudio.currentTime = pStart;
                smoothedAudioTime = pStart; 
                if (previewGain) previewGain.gain.value = 0;
                else previewAudio.volume = 0;
            } else {
                let targetVolume = PREVIEW_MAX_VOLUME;
                if (current >= pStart && current < pStart + FADE_DURATION) {
                    let progress = (current - pStart) / FADE_DURATION;
                    targetVolume = Math.min(progress * PREVIEW_MAX_VOLUME, PREVIEW_MAX_VOLUME);
                } 
                else if (current <= pEnd && current > pEnd - FADE_DURATION) {
                    let progress = (pEnd - current) / FADE_DURATION;
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
        
        const currentMusic = musicList[selectedIndex];

        if (currentMusic.isCustom) {
            document.getElementById('select-bg').style.backgroundImage = `linear-gradient(135deg, #0f172a, #000000)`;
            document.getElementById('music-title').textContent = currentMusic.title;
            
            document.getElementById('music-bpm').classList.add('hidden');
            document.getElementById('music-desc').classList.add('hidden');
            
            const customArea = document.getElementById('custom-input-area');
            customArea.classList.remove('hidden');
            customArea.classList.add('flex');
        } else {
            document.getElementById('select-bg').style.backgroundImage = `url('${ASSET_URL}music/${currentMusic.filename}.png')`;
            document.getElementById('music-title').textContent = currentMusic.title;
            
            const bpmEl = document.getElementById('music-bpm');
            bpmEl.classList.remove('hidden');
            bpmEl.textContent = `BPM: ${currentMusic.bpm}`;
            
            const descEl = document.getElementById('music-desc');
            descEl.classList.remove('hidden');
            descEl.textContent = currentMusic.description;
            
            const customArea = document.getElementById('custom-input-area');
            customArea.classList.add('hidden');
            customArea.classList.remove('flex');
        }
        
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
            
            let audioUrl = `${ASSET_URL}music/${music.filename}.mp3`;
            let manualBpm = music.bpm;

            if (music.isCustom) {
                if (!currentCustomAudioUrl) {
                    throw new Error("楽曲ファイルを選択してください");
                }
                audioUrl = currentCustomAudioUrl;
                
                const bpmInput = document.getElementById('custom-bpm').value.trim();
                const parsedBpm = parseFloat(bpmInput);
                manualBpm = (!isNaN(parsedBpm) && parsedBpm > 0) ? parsedBpm : null;
            }
            
            if (!state.audioContext) {
                state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (state.audioContext.state === 'suspended') {
                await state.audioContext.resume();
            }

            // ★ キャッシュがあれば再読み込みをスキップして高速化
            if (state.audioBuffer && state.currentAudioUrl === audioUrl) {
                loadingMsg.textContent = "譜面を自動生成中...";
            } else {
                const response = await fetch(audioUrl);
                if (!response.ok) throw new Error("楽曲ファイルが見つかりません (またはCORS制限)");
                const arrayBuffer = await response.arrayBuffer();
                
                loadingMsg.textContent = "音声をデコード中...";
                state.audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
                state.currentAudioUrl = audioUrl;
                loadingMsg.textContent = "譜面を自動生成中...";
            }
            
            setTimeout(async () => {
                try {
                    const maxSliderIntervalBeat = minIntervalBeat * 3.0; 
                    await GraNotes.Analyzer.generateMap(state.audioBuffer, minIntervalBeat, maxSliderIntervalBeat, manualBpm);
                    
                    document.getElementById('screen-title').classList.add('hidden');
                    document.getElementById('hud-layer').classList.remove('hidden');
                    GraNotes.Game.startGame();
                } catch (err) {
                    console.error("生成中にエラーが発生しました:", err);
                    showMessage("解析エラー: " + err.message, true);
                    
                    setTimeout(() => {
                        diffSelect.classList.remove('hidden');
                        updateCarousel(); 
                    }, 3000);
                }
            }, 50);

        } catch (err) {
            console.error("楽曲ロードエラー:", err);
            showMessage("エラー: " + err.message, true);
            
            setTimeout(() => {
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

        if (music.isCustom) {
            document.getElementById('res-music-image').style.backgroundImage = `linear-gradient(135deg, #334155, #0f172a)`;
            document.getElementById('res-music-image').innerHTML = `
                <div class="w-full h-full flex flex-col justify-center items-center text-gray-400">
                    <svg class="w-10 h-10 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
                    </svg>
                    <span class="text-sm font-bold tracking-wider">LOCAL</span>
                </div>`;
        } else {
            document.getElementById('res-music-image').style.backgroundImage = `url('${ASSET_URL}music/${music.filename}.png')`;
            document.getElementById('res-music-image').innerHTML = '';
        }
        
        document.getElementById('res-music-title').textContent = music.title;
        document.getElementById('res-music-diff').textContent = selectedDifficultyName;

        const finalScore = Math.floor(state.score);
        document.getElementById('result-score').textContent = finalScore;
        document.getElementById('res-perfect').textContent = state.stats.perfect;
        document.getElementById('res-good').textContent = state.stats.good;
        document.getElementById('res-miss').textContent = state.stats.miss;
        document.getElementById('res-combo').textContent = state.maxCombo;

        if (!music.isCustom) {
            setTimeout(() => {
                reportScore(finalScore);
            }, 500);
        } else {
            console.log("カスタム楽曲のためスコア送信をスキップしました。");
        }
    }

    window.GraNotesUI = {
        build: build,
        updateHUD: updateHUD,
        showJudge: showJudge,
        showResult: showResult
    };

    return window.GraNotesUI;
})();