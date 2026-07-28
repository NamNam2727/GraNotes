// --- 音声解析・譜面生成エンジン (analyzer.js) ---

window.GraNotes = window.GraNotes || {};

GraNotes.Analyzer = (function() {
    
    function cosineSimilarity(vecA, vecB) {
        let dotP = 0, nA = 0, nB = 0;
        for (let i = 0; i < vecA.length; i++) { 
            dotP += vecA[i]*vecB[i]; nA += vecA[i]*vecA[i]; nB += vecB[i]*vecB[i]; 
        }
        if (nA === 0 || nB === 0) return 0; 
        return dotP / (Math.sqrt(nA) * Math.sqrt(nB));
    }

    function getPitch(data, start, length, sr) {
        let zc = 0; 
        for(let i=1; i<length; i++) {
            if(data[start+i-1]>0 && data[start+i]<=0) zc++;
        }
        return (zc * sr) / length; 
    }

    async function generateMap(buffer, minIntervalBeat, maxSliderIntervalBeat, manualBpm) {
        const state = GraNotes.State;
        const config = GraNotes.ENGINE_CONFIG;
        
        const duration = buffer.duration; 
        const sampleRate = buffer.sampleRate;
        
        // ★ 修正点: 一部のブラウザで小数を渡すとエラーになって止まるため、Math.ceilで確実に整数にする
        const offlineCtx = new OfflineAudioContext(3, Math.ceil(duration * sampleRate), sampleRate);
        const source = offlineCtx.createBufferSource(); 
        source.buffer = buffer;

        const lowFilter = offlineCtx.createBiquadFilter(); lowFilter.type = 'lowpass'; lowFilter.frequency.value = 150;
        const midFilter = offlineCtx.createBiquadFilter(); midFilter.type = 'bandpass'; midFilter.frequency.value = config.freq; midFilter.Q.value = config.q;
        const highFilter = offlineCtx.createBiquadFilter(); highFilter.type = 'highpass'; highFilter.frequency.value = 3500;

        const merger = offlineCtx.createChannelMerger(3);
        source.connect(lowFilter); lowFilter.connect(merger, 0, 0); 
        source.connect(midFilter); midFilter.connect(merger, 0, 1);
        source.connect(highFilter); highFilter.connect(merger, 0, 2); 
        merger.connect(offlineCtx.destination); source.start();

        const renderedBuffer = await offlineCtx.startRendering();
        const lowData = renderedBuffer.getChannelData(0); 
        const midData = renderedBuffer.getChannelData(1); 
        const highData = renderedBuffer.getChannelData(2);
        
        const hopSize = Math.floor(sampleRate * 0.01); 

        // ★ Spectral Fluxを用いたオンセットエンベロープ(ノベルティ関数)の生成
        const novelty = [];
        const hitTimes = [];
        let tempPrevLow = 0, tempPrevMid = 0, tempPrevHigh = 0;
        let noveltySum = 0;
        
        for (let i = 0; i < lowData.length; i += hopSize) {
            let l = 0, m = 0, h = 0;
            for (let j = 0; j < hopSize && (i + j) < lowData.length; j++) { 
                l += lowData[i+j]*lowData[i+j]; 
                m += midData[i+j]*midData[i+j]; 
                h += highData[i+j]*highData[i+j]; 
            }
            l = Math.sqrt(l/hopSize); 
            m = Math.sqrt(m/hopSize); 
            h = Math.sqrt(h/hopSize);
            
            // ★ isMidHit を収集 (phaseOffset 推定用)
            if (m - tempPrevMid > config.diffThresh && m > config.absThresh) {
                hitTimes.push(i / sampleRate);
            }
            
            // RMSエネルギーの増加分（半波整流）を合算して Spectral Flux を計算
            const dL = Math.max(0, l - tempPrevLow);
            const dM = Math.max(0, m - tempPrevMid);
            const dH = Math.max(0, h - tempPrevHigh);
            
            const flux = dL + dM + dH;
            novelty.push(flux);
            noveltySum += flux;
            
            tempPrevLow = l; 
            tempPrevMid = m; 
            tempPrevHigh = h;
        }
        
        // 直流(DC)成分を取り除くため、平均を引く (Mean Subtraction)
        // これにより自己相関のベースラインが安定し、周期性が明確になります。
        const noveltyMean = noveltySum / novelty.length;
        for (let i = 0; i < novelty.length; i++) {
            novelty[i] -= noveltyMean;
        }

        // --- 1. BPM設定 (手動指定 or 自動推定) ---
        let beatDuration = 0.5;

        if (manualBpm && manualBpm > 0) {
            state.bpm = manualBpm;
            beatDuration = 60 / state.bpm;
            console.log(`[GraNotes] BPM Applied (Manual): ${state.bpm}`);
        } else {
            // ★ 自己相関(Auto Correlation)によるBPM推定
            let bestBpm = 120;
            let maxAcf = -Infinity;
            const frameRate = sampleRate / hopSize; 
            
            // 候補BPM範囲 70〜200 を 0.1 刻みで評価
            for (let bpm = 70; bpm <= 200; bpm += 0.1) {
                const lag = (60 / bpm) * frameRate;
                const lagInt = Math.floor(lag);
                const lagFrac = lag - lagInt;
                
                let acf = 0;
                let count = 0;
                const maxI = novelty.length - lagInt - 1;
                
                for (let i = 0; i < maxI; i++) {
                    // 線形補間による遅延サンプルの取得で精度を担保
                    const delayed = novelty[i + lagInt] * (1 - lagFrac) + novelty[i + lagInt + 1] * lagFrac;
                    acf += novelty[i] * delayed;
                    count++;
                }
                
                // サンプル数で正規化し、短いラグ（早いBPM）へのバイアスを防ぐ
                if (count > 0) acf /= count;
                
                if (acf > maxAcf) {
                    maxAcf = acf;
                    bestBpm = bpm;
                }
            }
            
            // ★ 自己相関で求めたBPMを整数化
            let calculatedBpm = Math.round(bestBpm);
            
            // ★ BPMが90以下の場合は、2倍にして倍のテンポとして扱う（遅すぎる譜面を防ぐため）
            if (calculatedBpm <= 90) {
                console.log(`[GraNotes] Detected BPM (${calculatedBpm}) is too slow. Doubling the BPM.`);
                calculatedBpm *= 2;
            }
            
            // ★ 一般化されたスナップ処理：±2BPM以内なら10刻みにスナップ
            const remainder = calculatedBpm % 10;
            if (remainder <= 2) {
                calculatedBpm -= remainder; // 例: 152 -> 150, 151 -> 150
            } else if (remainder >= 8) {
                calculatedBpm += (10 - remainder); // 例: 148 -> 150, 149 -> 150
            }

            state.bpm = calculatedBpm;
            beatDuration = 60 / state.bpm;
            console.log(`[GraNotes] BPM Applied (Auto via AutoCorrelation): ${state.bpm}`);
        }

        state.measureDuration = beatDuration * 4; 

        // ★ Beat Phase (phaseOffset) の推定
        let bestOffset = 0;
        let maxPhaseScore = -Infinity;
        const offsetStep = 0.005; // 5ms刻み
        
        for (let offset = 0; offset < beatDuration; offset += offsetStep) {
            let score = 0;
            for (let i = 0; i < hitTimes.length; i++) {
                const time = hitTimes[i];
                const mod = ((time - offset) % beatDuration + beatDuration) % beatDuration;
                // 拍頭までの距離を計算 (0 から beatDuration/2 の範囲)
                const distance = Math.min(mod, beatDuration - mod);
                // 距離が近いほど高スコアになるように評価
                score += (beatDuration / 2) - distance;
            }
            if (score > maxPhaseScore) {
                maxPhaseScore = score;
                bestOffset = offset;
            }
        }
        
        state.phaseOffset = bestOffset;
        console.log(`[GraNotes] Phase Offset Applied: ${state.phaseOffset.toFixed(3)} s`);

        const CHUNK_DURATION = beatDuration * 8; 

        const minIntervalSeconds = beatDuration * minIntervalBeat;
        const maxSliderIntervalSeconds = beatDuration * maxSliderIntervalBeat;

        // --- 2. 楽曲構造の詳細リズムパターン解析 ---
        const chunks = []; let currentChunkIndex = -1;
        let prevLow = 0, prevMid = 0, prevHigh = 0;
        
        const prng = new GraNotes.XorShift(12345);
        const midRmsHistory = [];

        for (let i = 0; i < lowData.length; i += hopSize) {
            const currentTime = i / sampleRate;
            const chunkIdx = Math.floor(currentTime / CHUNK_DURATION);
            
            if (chunkIdx > currentChunkIndex) {
                chunks.push({
                    index: chunkIdx, startTime: chunkIdx * CHUNK_DURATION,
                    features: new Array(24).fill(0), notes: [], mappedTo: null, prngState: prng.getState()
                });
                currentChunkIndex = chunkIdx;
            }

            let l=0, m=0, h=0;
            for (let j = 0; j < hopSize && (i+j) < lowData.length; j++) { 
                l += lowData[i+j]*lowData[i+j]; m += midData[i+j]*midData[i+j]; h += highData[i+j]*highData[i+j]; 
            }
            l = Math.sqrt(l/hopSize); m = Math.sqrt(m/hopSize); h = Math.sqrt(h/hopSize);
            midRmsHistory.push({ time: currentTime, rms: m });

            const lDiff = l - prevLow; const mDiff = m - prevMid; const hDiff = h - prevHigh;
            const isLowHit = lDiff > 0.05 && l > 0.06; 
            const isMidHit = mDiff > config.diffThresh && m > config.absThresh; 
            const isHighHit = hDiff > 0.03 && h > 0.04;
            
            const chunk = chunks[chunkIdx];
            const beatIndex = Math.floor((currentTime % CHUNK_DURATION) / beatDuration);
            if (beatIndex >= 0 && beatIndex < 8) {
                if (isLowHit) chunk.features[beatIndex * 3 + 0] += 1;
                if (isMidHit) chunk.features[beatIndex * 3 + 1] += 1;
                if (isHighHit) chunk.features[beatIndex * 3 + 2] += 1;
            }

            if (isMidHit) {
                let pitchValue = getPitch(midData, i, hopSize, sampleRate);
                chunk.notes.push({ time: currentTime, pitch: pitchValue, seedVal: prng.next() });
            }
            prevLow = l; prevMid = m; prevHigh = h;
        }

        for (let i = 1; i < chunks.length; i++) {
            for (let j = 0; j < i - 1; j++) {
                const totalHits = chunks[i].features.reduce((a,b)=>a+b, 0);
                if (totalHits < 4) continue; 
                if (cosineSimilarity(chunks[i].features, chunks[j].features) > 0.85) {
                    chunks[i].mappedTo = j; break; 
                }
            }
        }

        let allNotes = [];
        chunks.forEach((chunk) => {
            let sourceNotes = chunk.notes;
            if (chunk.mappedTo !== null) {
                const sourceChunk = chunks[chunk.mappedTo];
                const timeOffset = chunk.startTime - sourceChunk.startTime;
                sourceNotes = sourceChunk.notes.map(n => ({ time: n.time + timeOffset, pitch: n.pitch, seedVal: n.seedVal }));
            }
            sourceNotes.forEach(note => allNotes.push(note));
        });

        allNotes.sort((a, b) => a.time - b.time);

        let rawNotes = [];
        let lastTime = -100;
        allNotes.forEach(note => {
            if (note.time - lastTime >= minIntervalSeconds) { 
                rawNotes.push(note); 
                lastTime = note.time; 
            }
        });

        // --- 3. ノーツの統合と相対ピッチによる座標計算 ---
        const notesByMeasure = {};
        rawNotes.forEach(note => {
            const measureIndex = Math.floor((note.time - state.phaseOffset) / state.measureDuration);
            if (!notesByMeasure[measureIndex]) notesByMeasure[measureIndex] = [];
            notesByMeasure[measureIndex].push(note);
        });

        for (const measureIndex in notesByMeasure) {
            const measureNotes = notesByMeasure[measureIndex];
            if (measureNotes.length <= 1) {
                measureNotes.forEach(n => n.pitchNorm = 0.5); 
            } else {
                let minPitch = Infinity, maxPitch = -Infinity;
                measureNotes.forEach(n => {
                    if (n.pitch < minPitch) minPitch = n.pitch;
                    if (n.pitch > maxPitch) maxPitch = n.pitch;
                });
                const pitchRange = maxPitch - minPitch;
                measureNotes.forEach(n => {
                    if (pitchRange === 0) n.pitchNorm = 0.5;
                    else n.pitchNorm = (n.pitch - minPitch) / pitchRange; 
                });
            }
        }

        function isSoundConnected(startTime, endTime) {
            let disconnectedFrames = 0;
            for (let i = 0; i < midRmsHistory.length; i++) {
                const h = midRmsHistory[i];
                if (h.time > startTime && h.time < endTime) {
                    if (h.rms < config.sustainThresh) disconnectedFrames++;
                }
                if (h.time >= endTime) break;
            }
            return disconnectedFrames < 2; 
        }

        let noteGroups = [];
        let currentGroup = null;

        rawNotes.forEach((note, index) => {
            const time = note.time;
            const measureIndex = Math.floor((time - state.phaseOffset) / state.measureDuration);
            const isTopRow = (measureIndex % 2 === 0); 
            
            // 剰余(%)を使わずに進行度を計算し、範囲を確実に0.0〜1.0に収める
            let progressInMeasure = (time - state.phaseOffset - (measureIndex * state.measureDuration)) / state.measureDuration;
            if (progressInMeasure < 0) progressInMeasure = 0;
            if (progressInMeasure > 1) progressInMeasure = 1;

            const x = isTopRow ? 0.1 + (progressInMeasure * 0.8) : 0.9 - (progressInMeasure * 0.8);

            const baseY = isTopRow ? 0.35 : 0.65;
            let yOffset = (0.5 - note.pitchNorm) * 0.24; 
            yOffset += (note.seedVal - 0.5) * 0.03; 

            const y = baseY + yOffset; 
            const newNode = { id: index, time: time, x: x, y: y, hit: false };

            let isSameGroup = false;
            if (currentGroup) {
                const lastNode = currentGroup.nodes[currentGroup.nodes.length - 1];
                const isConnected = isSoundConnected(lastNode.time, time);
                
                if ((time - lastNode.time <= maxSliderIntervalSeconds) && 
                    (Math.floor((lastNode.time - state.phaseOffset) / state.measureDuration) === measureIndex) &&
                    isConnected) {
                    isSameGroup = true;
                }
            }

            if (isSameGroup) {
                currentGroup.nodes.push(newNode);
            } else {
                currentGroup = { id: index, nodes: [newNode], type: 'mid' };
                noteGroups.push(currentGroup);
            }
        });

        state.generatedNotes = noteGroups;
    }

    return {
        generateMap: generateMap
    };
})();