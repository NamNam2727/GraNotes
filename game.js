// --- ゲームループ・判定・描画処理 (game.js) ---

window.GraNotes = window.GraNotes || {};

GraNotes.Game = (function() {
    let ctx = null;
    let canvas = null;

    // 定数
    const JUDGE_TIME_PERFECT = 0.08;
    const JUDGE_TIME_GOOD = 0.15;
    const HIT_RADIUS = 50;
    const COLOR_PRIMARY = 'rgba(20, 184, 166, '; // Teal-500

    function init(canvasElement) {
        canvas = canvasElement;
        ctx = canvas.getContext('2d');
        
        // タッチイベントの登録
        canvas.addEventListener('mousedown', (e) => handleTap(e.clientX, e.clientY));
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault(); 
            for(let i=0; i<e.changedTouches.length; i++) {
                handleTap(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
            }
        }, {passive: false});
    }

    function startGame() {
        const state = GraNotes.State;
        
        // スコア初期化
        state.score = 0; state.combo = 0; state.maxCombo = 0; 
        state.stats = { perfect: 0, good: 0, miss: 0 };
        GraNotesUI.updateHUD();
        
        state.playSource = state.audioContext.createBufferSource(); 
        state.playSource.buffer = state.audioBuffer;
        state.playSource.connect(state.audioContext.destination); 
        state.playSource.start();
        
        state.startTime = state.audioContext.currentTime; 
        state.isPlaying = true;
        
        state.playSource.onended = stopGame;
        drawFrame();
    }

    function stopGame() {
        const state = GraNotes.State;
        state.isPlaying = false;
        if (state.playSource) { 
            state.playSource.disconnect(); 
            state.playSource = null; 
        }
        cancelAnimationFrame(state.animationId);
        GraNotesUI.showResult();
    }

    // --- 判定ロジック ---
    function handleTap(eventX, eventY) {
        const state = GraNotes.State;
        if (!state.isPlaying) return;
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const tapX = (eventX - rect.left) * scaleX;
        const tapY = (eventY - rect.top) * scaleY;

        const currentTime = state.audioContext.currentTime - state.startTime;

        for (let g of state.generatedNotes) {
            for (let node of g.nodes) {
                if (node.hit) continue; 
                
                const timeDiff = Math.abs(node.time - currentTime);
                if (timeDiff > JUDGE_TIME_GOOD) continue; 

                const cx = node.x * canvas.width;
                const cy = node.y * canvas.height;
                const dist = Math.sqrt(Math.pow(tapX - cx, 2) + Math.pow(tapY - cy, 2));

                if (dist <= HIT_RADIUS) {
                    node.hit = true;
                    node.hitTime = currentTime; 
                    node.hitType = timeDiff <= JUDGE_TIME_PERFECT ? 'perfect' : 'good';
                    
                    addScore(node.hitType === 'perfect' ? 1000 : 500, node.hitType === 'perfect');
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

    // --- 描画ループ (プロトタイプ版の美しい挙動を復元) ---
    function drawFrame() {
        const state = GraNotes.State;
        if (!state.isPlaying) return; 
        
        state.animationId = requestAnimationFrame(drawFrame);
        const currentTime = state.audioContext.currentTime - state.startTime; 
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // --- 背景ガイドライン ---
        const isTopRow = Math.floor(currentTime / state.measureDuration) % 2 === 0;
        ctx.lineWidth = 2; ctx.strokeStyle = '#1e293b';
        ctx.beginPath(); ctx.moveTo(0, canvas.height * 0.5); ctx.lineTo(canvas.width, canvas.height * 0.5); ctx.stroke(); 

        ctx.setLineDash([5, 5]); ctx.strokeStyle = '#334155';
        ctx.beginPath(); ctx.moveTo(0, canvas.height * 0.35); ctx.lineTo(canvas.width, canvas.height * 0.35); ctx.stroke(); 
        ctx.beginPath(); ctx.moveTo(0, canvas.height * 0.65); ctx.lineTo(canvas.width, canvas.height * 0.65); ctx.stroke(); 
        ctx.setLineDash([]);

        const measureProgress = (currentTime % state.measureDuration) / state.measureDuration;
        ctx.fillStyle = 'rgba(20, 184, 166, 0.08)'; 
        if (isTopRow) { 
            ctx.fillRect(0, canvas.height * 0.23, canvas.width * measureProgress, canvas.height * 0.24); 
        } else { 
            ctx.fillRect(canvas.width - (canvas.width * measureProgress), canvas.height * 0.53, canvas.width * measureProgress, canvas.height * 0.24); 
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; ctx.font = '24px sans-serif';
        ctx.fillText('→', 20, canvas.height * 0.35 + 8); ctx.fillText('←', canvas.width - 40, canvas.height * 0.65 + 8); 

        const PRE_TIME = state.measureDuration * 0.8; 
        const maxRadius = 24; 

        // --- ノーツの描画 ---
        state.generatedNotes.forEach((group) => {
            const nodes = group.nodes; 
            const tFirst = nodes[0].time; 
            const tLast = nodes[nodes.length - 1].time;
            
            // 判定エフェクトの余韻を残すため、tLast + 0.5 秒まで描画対象にする
            if (currentTime < tFirst - PRE_TIME || currentTime > tLast + 0.5) return;
            
            // Miss判定の処理 (描画ループ内で行う)
            nodes.forEach(node => {
                if (!node.hit && !node.missed && currentTime > node.time + 0.15) {
                    node.missed = true;
                    breakCombo();
                }
            });

            let progress = Math.min(1.0, (currentTime - (tFirst - PRE_TIME)) / PRE_TIME);
            let alpha = progress; 
            if (currentTime > tLast) alpha = 1.0 - (currentTime - tLast) / 0.3; 

            // 1. スライダーの軌跡描画 (プロトタイプの完全復元)
            if (nodes.length > 1) {
                ctx.beginPath(); ctx.moveTo(nodes[0].x * canvas.width, nodes[0].y * canvas.height);
                for(let i=1; i<nodes.length; i++) ctx.lineTo(nodes[i].x * canvas.width, nodes[i].y * canvas.height);
                ctx.strokeStyle = COLOR_PRIMARY + (alpha * 0.3) + ')'; ctx.lineWidth = maxRadius * 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
                
                ctx.beginPath(); ctx.moveTo(nodes[0].x * canvas.width, nodes[0].y * canvas.height);
                for(let i=1; i<nodes.length; i++) ctx.lineTo(nodes[i].x * canvas.width, nodes[i].y * canvas.height);
                ctx.strokeStyle = COLOR_PRIMARY + (alpha * 0.8) + ')'; ctx.lineWidth = 4; ctx.stroke();
                
                nodes.forEach(n => { 
                    ctx.beginPath(); ctx.arc(n.x * canvas.width, n.y * canvas.height, maxRadius * 0.3, 0, Math.PI*2); 
                    ctx.fillStyle = COLOR_PRIMARY + (alpha * 0.6) + ')'; ctx.fill(); 
                });
            }

            // 2. 光るターゲットの現在地計算
            let targetX = nodes[0].x; let targetY = nodes[0].y; let isActive = false; 
            if (currentTime >= tFirst && currentTime <= tLast) {
                isActive = true;
                for (let i = 0; i < nodes.length - 1; i++) {
                    if (currentTime >= nodes[i].time && currentTime <= nodes[i+1].time) {
                        let ratio = (currentTime - nodes[i].time) / (nodes[i+1].time - nodes[i].time);
                        targetX = nodes[i].x + (nodes[i+1].x - nodes[i].x) * ratio; targetY = nodes[i].y + (nodes[i+1].y - nodes[i].y) * ratio; break;
                    }
                }
            } else if (currentTime > tLast) { 
                targetX = nodes[nodes.length - 1].x; targetY = nodes[nodes.length - 1].y; 
            }

            let cx = targetX * canvas.width; let cy = targetY * canvas.height;
            
            // 3. アプローチリングの描画 (スライダーも単発も最初のノーツに表示)
            if (currentTime < tFirst) {
                let p = 1.0 - ((tFirst - currentTime) / PRE_TIME);
                ctx.beginPath(); ctx.arc(nodes[0].x * canvas.width, nodes[0].y * canvas.height, maxRadius + (maxRadius * 2 * (1 - p)), 0, Math.PI * 2);
                ctx.strokeStyle = COLOR_PRIMARY + '0.8)'; ctx.lineWidth = 2; ctx.stroke();
            }

            // 4. ノーツ本体・光る玉の描画
            if (isActive && nodes.length > 1) {
                // スライダー中の光る追従玉
                ctx.beginPath(); ctx.arc(cx, cy, maxRadius * 1.2, 0, Math.PI * 2); ctx.fillStyle = COLOR_PRIMARY + '1.0)'; ctx.fill();
                ctx.beginPath(); ctx.arc(cx, cy, maxRadius * 0.6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
            } else if (nodes.length === 1) {
                // 単発ノーツの本体
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

            // 5. ヒットエフェクトの描画 (単発・スライダー共通)
            nodes.forEach(node => {
                if (node.hit) {
                    const elapsedSinceHit = currentTime - node.hitTime;
                    if (elapsedSinceHit < 0.3) {
                        const nx = node.x * canvas.width;
                        const ny = node.y * canvas.height;
                        const expand = 1.0 + (elapsedSinceHit / 0.3);
                        const fade = 1.0 - (elapsedSinceHit / 0.3);
                        ctx.beginPath(); ctx.arc(nx, ny, maxRadius * expand, 0, Math.PI*2);
                        ctx.strokeStyle = node.hitType === 'perfect' ? `rgba(253, 224, 71, ${fade})` : `rgba(134, 239, 172, ${fade})`;
                        ctx.lineWidth = 4; ctx.stroke();
                    }
                }
            });

        });
    }

    return {
        init: init,
        startGame: startGame
    };
})();


