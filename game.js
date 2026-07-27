// --- ゲームループ・判定・描画処理 (game.js) ---

window.GraNotes = window.GraNotes || {};

GraNotes.Game = (function() {
    let ctx = null;
    let canvas = null;

    // ==========================================
    // ★ タイミング・判定のカスタマイズ設定
    // ==========================================

    // ノーツの出現タイミングの微調整（秒単位）
    // 音楽に対してノーツが「早い(早く来すぎる)」場合はプラスの値を、
    // 音楽に対してノーツが「遅い(遅れて来る)」場合はマイナスの値を設定します。
    const NOTE_OFFSET = 0.10; // (例: 0.10秒 ノーツを遅らせる)

    // タップの判定時間（秒単位）。大きくするほどタイミング判定が甘くなります。
    const JUDGE_TIME_PERFECT = 0.10; // PERFECTになるズレの許容時間
    const JUDGE_TIME_GOOD = 0.20;    // GOODになるズレの許容時間
    const JUDGE_TIME_SLIDER_START = 0.30; // なぞりの最初のタップはさらに甘く
    
    // 当たり判定の大きさ（ピクセル単位）。大きくするほど位置判定が甘くなります。
    // 単発ノーツやなぞり始点タップ時の当たり判定の半径です。
    const HIT_RADIUS = 60;
    
    // なぞり中の許容範囲の大きさ（ピクセル単位）。
    // なぞっている最中の「点線の円」の大きさになります。
    const TRACKING_RADIUS = HIT_RADIUS * 1.5; 

    // 光る玉のメインカラー
    const COLOR_PRIMARY = 'rgba(20, 184, 166, '; 
    // ==========================================

    let activePointers = {};

    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
    }

    function updatePointer(id, clientX, clientY) {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        activePointers[id] = {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function removePointer(id) {
        delete activePointers[id];
    }

    function init(canvasElement) {
        canvas = canvasElement;
        ctx = canvas.getContext('2d');
        
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();
        
        canvas.addEventListener('mousedown', (e) => {
            updatePointer('mouse', e.clientX, e.clientY);
            handleTap(e.clientX, e.clientY); 
        });
        canvas.addEventListener('mousemove', (e) => {
            if (activePointers['mouse']) updatePointer('mouse', e.clientX, e.clientY); 
        });
        window.addEventListener('mouseup', () => removePointer('mouse'));
        window.addEventListener('mouseleave', () => removePointer('mouse'));
        
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault(); 
            for(let i=0; i<e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                updatePointer(touch.identifier, touch.clientX, touch.clientY);
                handleTap(touch.clientX, touch.clientY); 
            }
        }, {passive: false});
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault(); 
            for(let i=0; i<e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                updatePointer(touch.identifier, touch.clientX, touch.clientY); 
            }
        }, {passive: false});
        canvas.addEventListener('touchend', (e) => {
            for(let i=0; i<e.changedTouches.length; i++) {
                removePointer(e.changedTouches[i].identifier);
            }
        });
        canvas.addEventListener('touchcancel', (e) => {
            for(let i=0; i<e.changedTouches.length; i++) {
                removePointer(e.changedTouches[i].identifier);
            }
        });
    }

    function startGame() {
        const state = GraNotes.State;
        
        state.score = 0; state.combo = 0; state.maxCombo = 0; 
        state.stats = { perfect: 0, good: 0, miss: 0 };
        activePointers = {}; 
        GraNotesUI.updateHUD();
        
        state.playSource = state.audioContext.createBufferSource(); 
        state.playSource.buffer = state.audioBuffer;
        state.playSource.connect(state.audioContext.destination); 
        state.playSource.start();
        
        state.startTime = state.audioContext.currentTime; 
        state.isPlaying = true;
        
        state.playSource.onended = () => stopGame(false);
        
        resizeCanvas();
        drawFrame();
    }

    function stopGame(isRetire = false) {
        const state = GraNotes.State;
        if (!state.isPlaying) return; 

        state.isPlaying = false;
        
        if (state.playSource) { 
            state.playSource.onended = null; 
            state.playSource.disconnect(); 
            state.playSource.stop(); 
            state.playSource = null; 
        }
        cancelAnimationFrame(state.animationId);
        
        GraNotesUI.showResult(isRetire);
    }

    function handleTap(eventX, eventY) {
        const state = GraNotes.State;
        if (!state.isPlaying) return;
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const tapX = (eventX - rect.left) * scaleX;
        const tapY = (eventY - rect.top) * scaleY;

        // ★ 音声の再生時間からオフセットを引いて、ノーツの表示と判定をズラす
        const baseTime = state.audioContext.currentTime - state.startTime;
        const currentTime = baseTime - NOTE_OFFSET;

        for (let g of state.generatedNotes) {
            for (let i = 0; i < g.nodes.length; i++) {
                const node = g.nodes[i];
                if (node.hit) continue; 
                
                if (g.nodes.length > 1 && i > 0) continue;
                
                const timeDiff = Math.abs(node.time - currentTime);
                const isSliderStart = (g.nodes.length > 1 && i === 0);
                const maxJudgeTime = isSliderStart ? JUDGE_TIME_SLIDER_START : JUDGE_TIME_GOOD;
                
                if (timeDiff > maxJudgeTime) continue; 

                const cx = node.x * canvas.width;
                const cy = node.y * canvas.height;
                const dist = Math.sqrt(Math.pow(tapX - cx, 2) + Math.pow(tapY - cy, 2));

                if (dist <= HIT_RADIUS) {
                    node.hit = true;
                    node.hitTime = currentTime; 
                    node.hitType = timeDiff <= JUDGE_TIME_PERFECT ? 'perfect' : 'good';
                    
                    const scoreVal = node.hitType === 'perfect' ? 200 : 100;
                    addScore(scoreVal, node.hitType === 'perfect');
                    return; 
                }
            }
        }
    }

    function addScore(baseScore, isPerfect) {
        const state = GraNotes.State;
        
        const comboMultiplier = 1.0 + (state.combo * 0.01);
        state.score += baseScore * comboMultiplier;
        
        state.combo++;
        if (state.combo > state.maxCombo) state.maxCombo = state.combo;
        
        if(isPerfect) { 
            state.stats.perfect++; 
            GraNotesUI.showJudge("PERFECT", "#fde047"); 
        } else { 
            state.stats.good++; 
            GraNotesUI.showJudge("GOOD", "#86efac"); 
        }
        
        GraNotesUI.updateHUD();
    }

    function breakCombo() {
        const state = GraNotes.State;
        if(state.combo > 0) GraNotesUI.showJudge("MISS", "#94a3b8");
        state.combo = 0; 
        state.stats.miss++; 
        GraNotesUI.updateHUD();
    }

    function drawFrame() {
        const state = GraNotes.State;
        if (!state.isPlaying) return; 
        
        state.animationId = requestAnimationFrame(drawFrame);
        
        // ★ 音声の再生時間からオフセットを引いて、ノーツの表示と判定をズラす
        const baseTime = state.audioContext.currentTime - state.startTime; 
        const currentTime = baseTime - NOTE_OFFSET;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const isTopRow = Math.floor(currentTime / state.measureDuration) % 2 === 0;
        ctx.lineWidth = 2; ctx.strokeStyle = '#1e293b';
        ctx.beginPath(); ctx.moveTo(0, canvas.height * 0.5); ctx.lineTo(canvas.width, canvas.height * 0.5); ctx.stroke(); 

        ctx.setLineDash([5, 5]); ctx.strokeStyle = '#334155';
        ctx.beginPath(); ctx.moveTo(0, canvas.height * 0.35); ctx.lineTo(canvas.width, canvas.height * 0.35); ctx.stroke(); 
        ctx.beginPath(); ctx.moveTo(0, canvas.height * 0.65); ctx.lineTo(canvas.width, canvas.height * 0.65); ctx.stroke(); 
        ctx.setLineDash([]);

        const measureProgress = (currentTime % state.measureDuration) / state.measureDuration;
        
        ctx.fillStyle = 'rgba(20, 184, 166, 0.15)'; 
        if (isTopRow) { 
            ctx.fillRect(0, canvas.height * 0.23, canvas.width * measureProgress, canvas.height * 0.24); 
        } else { 
            ctx.fillRect(canvas.width - (canvas.width * measureProgress), canvas.height * 0.53, canvas.width * measureProgress, canvas.height * 0.24); 
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; ctx.font = '24px sans-serif';
        ctx.fillText('→', 20, canvas.height * 0.35 + 8); ctx.fillText('←', canvas.width - 40, canvas.height * 0.65 + 8); 

        const PRE_TIME = state.measureDuration * 0.8; 
        const maxRadius = 24; 

        state.generatedNotes.forEach((group) => {
            const nodes = group.nodes; 
            const tFirst = nodes[0].time; 
            const tLast = nodes[nodes.length - 1].time;
            
            if (currentTime < tFirst - PRE_TIME || currentTime > tLast + 0.5) return;
            
            if (group.isSliderMissed === undefined) group.isSliderMissed = false;
            if (group.lostTime === undefined) group.lostTime = 0;
            
            if (group.isOffTrackCurrent === undefined) group.isOffTrackCurrent = false; 
            if (group.isOffTrackTotal === undefined) group.isOffTrackTotal = false;     
            
            const isSlider = nodes.length > 1;
            const isSliderCompleted = isSlider && nodes[nodes.length - 1].hit;

            let targetX = nodes[0].x; let targetY = nodes[0].y; let isActive = false; 
            if (currentTime >= tFirst && currentTime <= tLast) {
                isActive = true;
                for (let i = 0; i < nodes.length - 1; i++) {
                    if (currentTime >= nodes[i].time && currentTime <= nodes[i+1].time) {
                        let timeRange = nodes[i+1].time - nodes[i].time;
                        let ratio = timeRange <= 0.0001 ? 1.0 : (currentTime - nodes[i].time) / timeRange;
                        targetX = nodes[i].x + (nodes[i+1].x - nodes[i].x) * ratio; 
                        targetY = nodes[i].y + (nodes[i+1].y - nodes[i].y) * ratio; 
                        break;
                    }
                }
            } else if (currentTime > tLast) { 
                targetX = nodes[nodes.length - 1].x; targetY = nodes[nodes.length - 1].y; 
            }
            let cx = targetX * canvas.width; let cy = targetY * canvas.height;

            let isTrackedNow = false;
            
            if (isSlider && !group.isSliderMissed && !isSliderCompleted) {
                if (nodes[0].hit && currentTime >= tFirst) {
                    for (const pointerId in activePointers) {
                        const p = activePointers[pointerId];
                        const dist = Math.sqrt(Math.pow(p.x - cx, 2) + Math.pow(p.y - cy, 2));
                        if (dist <= TRACKING_RADIUS) { 
                            isTrackedNow = true;
                            break;
                        }
                    }

                    if (currentTime <= tLast + 0.15) {
                        if (!isTrackedNow) {
                            group.isOffTrackCurrent = true;
                            group.isOffTrackTotal = true;
                            
                            if (group.lostTime === 0) group.lostTime = currentTime;
                            if (currentTime - group.lostTime > 0.15) { 
                                group.isSliderMissed = true;
                                breakCombo();
                                nodes.forEach(n => { if(!n.hit) n.missed = true; });
                            }
                        } else {
                            group.lostTime = 0; 
                        }
                    }
                    
                    if (!group.isSliderMissed) {
                        nodes.forEach((node, index) => {
                            if (index > 0 && !node.hit) {
                                const isEndNode = (index === nodes.length - 1);
                                
                                if (!isEndNode) {
                                    if (currentTime >= node.time) {
                                        node.hit = true;
                                        node.hitTime = currentTime;
                                        let hitType = group.isOffTrackCurrent ? 'good' : 'perfect';
                                        group.isOffTrackCurrent = false; 
                                        node.hitType = hitType;
                                        addScore(hitType === 'perfect' ? 200 : 100, hitType === 'perfect');
                                    }
                                } else {
                                    if (currentTime >= node.time - 0.15 && currentTime <= node.time + 0.15) {
                                        if (!isTrackedNow) {
                                            node.hit = true;
                                            node.hitTime = currentTime;
                                            let hitType = group.isOffTrackTotal ? 'good' : 'perfect';
                                            node.hitType = hitType;
                                            addScore(hitType === 'perfect' ? 200 : 100, hitType === 'perfect');
                                        }
                                    }
                                    if (!node.hit && currentTime > node.time + 0.15) {
                                        node.hit = true;
                                        node.hitTime = currentTime;
                                        let hitType = group.isOffTrackTotal ? 'good' : 'perfect';
                                        node.hitType = hitType;
                                        addScore(hitType === 'perfect' ? 200 : 100, hitType === 'perfect');
                                    }
                                }
                            }
                        });
                    }
                }
            }

            const maxMissTime = isSlider ? JUDGE_TIME_SLIDER_START : JUDGE_TIME_GOOD;
            if (!nodes[0].hit && !nodes[0].missed && currentTime > nodes[0].time + maxMissTime) {
                nodes[0].missed = true;
                if (isSlider) group.isSliderMissed = true;
                breakCombo();
                nodes.forEach(n => n.missed = true);
            }

            let progress = Math.min(1.0, (currentTime - (tFirst - PRE_TIME)) / PRE_TIME);
            let alpha = progress; 
            if (currentTime > tLast) alpha = 1.0 - (currentTime - tLast) / 0.3; 

            if (isSlider) {
                ctx.beginPath(); ctx.moveTo(nodes[0].x * canvas.width, nodes[0].y * canvas.height);
                for(let i=1; i<nodes.length; i++) ctx.lineTo(nodes[i].x * canvas.width, nodes[i].y * canvas.height);
                ctx.strokeStyle = COLOR_PRIMARY + (alpha * 0.3) + ')'; ctx.lineWidth = maxRadius * 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
                
                ctx.beginPath(); ctx.moveTo(nodes[0].x * canvas.width, nodes[0].y * canvas.height);
                for(let i=1; i<nodes.length; i++) ctx.lineTo(nodes[i].x * canvas.width, nodes[i].y * canvas.height);
                ctx.strokeStyle = COLOR_PRIMARY + (alpha * 0.8) + ')'; ctx.lineWidth = 4; ctx.stroke();
            }
            
            if (currentTime < tFirst) {
                let p = 1.0 - ((tFirst - currentTime) / PRE_TIME);
                ctx.beginPath(); ctx.arc(nodes[0].x * canvas.width, nodes[0].y * canvas.height, maxRadius + (maxRadius * 2 * (1 - p)), 0, Math.PI * 2);
                ctx.strokeStyle = COLOR_PRIMARY + '0.8)'; ctx.lineWidth = 2; ctx.stroke();
            }

            if (isActive && isSlider) {
                if (!group.isSliderMissed) {
                    ctx.beginPath(); ctx.arc(cx, cy, maxRadius * 1.2, 0, Math.PI * 2); ctx.fillStyle = COLOR_PRIMARY + '1.0)'; ctx.fill();
                    ctx.beginPath(); ctx.arc(cx, cy, maxRadius * 0.6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
                    
                    if (nodes[0].hit && currentTime >= tFirst) {
                        ctx.beginPath(); 
                        ctx.arc(cx, cy, TRACKING_RADIUS, 0, Math.PI * 2);
                        ctx.setLineDash([6, 6]);
                        ctx.strokeStyle = isTrackedNow ? 'rgba(20, 184, 166, 0.8)' : 'rgba(239, 68, 68, 0.8)'; 
                        ctx.lineWidth = 2; 
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }

                    if (isTrackedNow) {
                        const pulse = 1.0 + Math.sin(currentTime * 20) * 0.3; 
                        ctx.beginPath(); ctx.arc(cx, cy, maxRadius * 2.0 * pulse, 0, Math.PI * 2);
                        ctx.fillStyle = `rgba(253, 224, 71, ${0.4 / pulse})`; 
                        ctx.fill();

                        ctx.save();
                        ctx.translate(cx, cy);
                        ctx.rotate(currentTime * 5); 
                        
                        ctx.beginPath();
                        ctx.moveTo(-maxRadius * 2.5, 0); ctx.lineTo(maxRadius * 2.5, 0);
                        ctx.moveTo(0, -maxRadius * 2.5); ctx.lineTo(0, maxRadius * 2.5);
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                        ctx.lineWidth = 3; ctx.stroke();
                        
                        ctx.beginPath();
                        ctx.moveTo(-maxRadius * 1.2, -maxRadius * 1.2); ctx.lineTo(maxRadius * 1.2, maxRadius * 1.2);
                        ctx.moveTo(maxRadius * 1.2, -maxRadius * 1.2); ctx.lineTo(-maxRadius * 1.2, maxRadius * 1.2);
                        ctx.lineWidth = 2; ctx.stroke();
                        
                        ctx.restore();
                    }
                } else {
                    ctx.beginPath(); ctx.arc(cx, cy, maxRadius * 1.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(100, 116, 139, 0.5)'; ctx.fill();
                }
            } else if (!isSlider) {
                let n = nodes[0];
                if (!n.hit && !n.missed) {
                    ctx.beginPath(); ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2); 
                    ctx.fillStyle = COLOR_PRIMARY + (currentTime > tFirst ? alpha : (0.3 + 0.7 * progress)) + ')'; ctx.fill();
                    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fillStyle = 'white'; ctx.fill();
                } else if (n.missed) {
                    ctx.beginPath(); ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2); 
                    ctx.fillStyle = 'rgba(100, 116, 139, 0.3)'; ctx.fill();
                }
            }

            nodes.forEach((node, index) => {
                if (node.hit) {
                    const elapsedSinceHit = currentTime - node.hitTime;
                    const isEndNode = (index === nodes.length - 1 && nodes.length > 1);
                    
                    if ((index === 0 || isEndNode) && elapsedSinceHit < 0.3) {
                        const nx = node.x * canvas.width;
                        const ny = node.y * canvas.height;
                        const expand = 1.0 + (elapsedSinceHit / 0.3);
                        const fade = 1.0 - (elapsedSinceHit / 0.3);
                        ctx.beginPath(); ctx.arc(nx, ny, maxRadius * expand, 0, Math.PI*2);
                        ctx.strokeStyle = node.hitType === 'perfect' ? `rgba(253, 224, 71, ${fade})` : `rgba(134, 239, 172, ${fade})`;
                        ctx.lineWidth = 4; ctx.stroke();
                    } 
                    else if (index > 0 && !isEndNode && elapsedSinceHit < 0.2) {
                        const nx = node.x * canvas.width;
                        const ny = node.y * canvas.height;
                        const expand = 1.0 + (elapsedSinceHit / 0.2);
                        const fade = 1.0 - (elapsedSinceHit / 0.2);
                        ctx.beginPath(); ctx.arc(nx, ny, maxRadius * expand * 0.8, 0, Math.PI*2);
                        
                        const rippleColor = node.hitType === 'perfect' ? `rgba(20, 184, 166, ${fade * 0.5})` : `rgba(134, 239, 172, ${fade * 0.5})`;
                        ctx.strokeStyle = rippleColor; 
                        ctx.lineWidth = 2; ctx.stroke();
                    }
                }
            });

        });
    }

    return {
        init: init,
        startGame: startGame,
        stopGame: stopGame
    };
})();


