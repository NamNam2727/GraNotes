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

    // ★ UIプレビュー用のBPM推定 (generateMap内の高精度ACFと全く同じロジック)
    async function estimateBPM(buffer) {
        const config = GraNotes.ENGINE_CONFIG;
        const duration = buffer.duration; 
        const sampleRate = buffer.sampleRate;
        
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

        const rawNovelty = [];
        let tempPrevLow = 0, tempPrevMid = 0, tempPrevHigh = 0;
        
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
            
            const dL = Math.max(0, l - tempPrevLow);
            const dM = Math.max(0, m - tempPrevMid);
            const dH = Math.max(0, h - tempPrevHigh);
            
            const flux = (dL * 2.5) + (dM * 0.8) + (dH * 0.1);
            rawNovelty.push(flux);
            
            tempPrevLow = l; 
            tempPrevMid = m; 
            tempPrevHigh = h;
        }

        const novelty = new Float32Array(rawNovelty.length);
        const windowSize = 1; 
        let noveltySum = 0;

        for (let i = 0; i < rawNovelty.length; i++) {
            let sum = 0, count = 0;
            for (let w = -windowSize; w <= windowSize; w++) {
                if (i + w >= 0 && i + w < rawNovelty.length) {
                    sum += rawNovelty[i + w];
                    count++;
                }
            }
            const val = sum / count;
            novelty[i] = val;
            noveltySum += val;
        }
        
        const noveltyMean = noveltySum / novelty.length;
        for (let i = 0; i < novelty.length; i++) {
            novelty[i] -= noveltyMean;
        }

        let bestBpm = 120;
        let maxScore = -Infinity;
        const frameRate = sampleRate / hopSize; 
        
        function calcAcfAtLag(l) {
            const lInt = Math.floor(l);
            const lFrac = l - lInt;
            let acf = 0;
            let count = 0;
            const maxI = novelty.length - lInt - 1;
            
            for (let i = 0; i < maxI; i++) {
                const delayed = novelty[i + lInt] * (1 - lFrac) + novelty[i + lInt + 1] * lFrac;
                acf += novelty[i] * delayed;
                count++;
            }
            return count > 0 ? acf / count : 0;
        }

        const variance = calcAcfAtLag(0) || 1;
        
        for (let bpm = 70; bpm <= 200; bpm += 0.1) {
            const lag = (60 / bpm) * frameRate;
            
            const acf1 = calcAcfAtLag(lag) / variance;
            const acf2 = calcAcfAtLag(lag * 2) / variance;
            const acf4 = calcAcfAtLag(lag * 4) / variance;
            const acfHalf = calcAcfAtLag(lag * 0.5) / variance; 
            
            const score = acf1 + (0.5 * acf2) + (0.25 * acf4) - (0.25 * acfHalf);
            
            const logBpm = Math.log2(bpm / 120);
            const tempoWeight = Math.exp(-0.5 * Math.pow(logBpm / 0.5, 2)); 
            
            const finalScore = score * tempoWeight;

            if (finalScore > maxScore) {
                maxScore = finalScore;
                bestBpm = bpm;
            }
        }
        
        let calculatedBpm = Math.round(bestBpm);
        
        if (calculatedBpm <= 90) {
            calculatedBpm *= 2;
        }
        
        const remainder = calculatedBpm % 10;
        if (remainder <= 2) {
            calculatedBpm -= remainder; 
        } else if (remainder >= 8) {
            calculatedBpm += (10 - remainder); 
        }

        return calculatedBpm;
    }

    async function generateMap(buffer, minIntervalBeat, maxSliderIntervalBeat, manualBpm) {
        const state = GraNotes.State;
        const config = GraNotes.ENGINE_CONFIG;
        
        const duration = buffer.duration; 
        const sampleRate = buffer.sampleRate;
        
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

        // --- Spectral Fluxを用いたオンセットエンベロープ(ノベルティ関数)の生成 ---
        const rawNovelty = [];
        let tempPrevLow = 0, tempPrevMid = 0, tempPrevHigh = 0;
        
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
            
            // キック（Low）を重視し、ハイハット（High）を軽視する重み付け
            const dL = Math.max(0, l - tempPrevLow);
            const dM = Math.max(0, m - tempPrevMid);
            const dH = Math.max(0, h - tempPrevHigh);
            
            const flux = (dL * 2.5) + (dM * 0.8) + (dH * 0.1);
            rawNovelty.push(flux);
            
            tempPrevLow = l; 
            tempPrevMid = m; 
            tempPrevHigh = h;
        }

        const novelty = new Float32Array(rawNovelty.length);
        const windowSize = 1; 
        let noveltySum = 0;

        for (let i = 0; i < rawNovelty.length; i++) {
            let sum = 0, count = 0;
            for (let w = -windowSize; w <= windowSize; w++) {
                if (i + w >= 0 && i + w < rawNovelty.length) {
                    sum += rawNovelty[i + w];
                    count++;
                }
            }
            const val = sum / count;
            novelty[i] = val;
            noveltySum += val;
        }
        
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
            let bestBpm = 120;
            let maxScore = -Infinity;
            const frameRate = sampleRate / hopSize; 
            
            function calcAcfAtLag(l) {
                const lInt = Math.floor(l);
                const lFrac = l - lInt;
                let acf = 0;
                let count = 0;
                const maxI = novelty.length - lInt - 1;
                
                for (let i = 0; i < maxI; i++) {
                    const delayed = novelty[i + lInt] * (1 - lFrac) + novelty[i + lInt + 1] * lFrac;
                    acf += novelty[i] * delayed;
                    count++;
                }
                return count > 0 ? acf / count : 0;
            }

            const variance = calcAcfAtLag(0) || 1;
            
            for (let bpm = 70; bpm <= 200; bpm += 0.1) {
                const lag = (60 / bpm) * frameRate;
                
                const acf1 = calcAcfAtLag(lag) / variance;
                const acf2 = calcAcfAtLag(lag * 2) / variance;
                const acf4 = calcAcfAtLag(lag * 4) / variance;
                const acfHalf = calcAcfAtLag(lag * 0.5) / variance; 
                
                const score = acf1 + (0.5 * acf2) + (0.25 * acf4) - (0.25 * acfHalf);
                
                const logBpm = Math.log2(bpm / 120);
                const tempoWeight = Math.exp(-0.5 * Math.pow(logBpm / 0.5, 2)); 
                
                const finalScore = score * tempoWeight;

                if (finalScore > maxScore) {
                    maxScore = finalScore;
                    bestBpm = bpm;
                }
            }
            
            let calculatedBpm = Math.round(bestBpm);
            
            if (calculatedBpm <= 90) {
                console.log(`[GraNotes] Detected BPM (${calculatedBpm}) is too slow. Doubling the BPM.`);
                calculatedBpm *= 2;
            }
            
            const remainder = calculatedBpm % 10;
            if (remainder <= 2) {
                calculatedBpm -= remainder; 
            } else if (remainder >= 8) {
                calculatedBpm += (10 - remainder); 
            }

            state.bpm = calculatedBpm;
            beatDuration = 60 / state.bpm;
            console.log(`[GraNotes] BPM Applied (Auto via Normalized ACF + Tempo Prior): ${state.bpm}`);
        }

        state.measureDuration = beatDuration * 4; 

        // --- 1.5. Dynamic Programming による Beat Tracking (Phase Offset推定) ---
        const beatPeriod = Math.round(beatDuration * sampleRate / hopSize);
        const C = new Float32Array(novelty.length);
        const P = new Int32Array(novelty.length);
        
        let posSum = 0;
        let posCount = 0;
        for (let i = 0; i < novelty.length; i++) {
            if (novelty[i] > 0) {
                posSum += novelty[i];
                posCount++;
            }
        }
        const normFactor = (posCount > 0 && posSum > 0) ? 1.0 / (posSum / posCount) : 1.0;
        
        const minSearch = Math.max(1, Math.round(beatPeriod * 0.5));
        const maxSearch = Math.round(beatPeriod * 2.0);
        const alpha = 100.0; 
        
        for (let i = 0; i < novelty.length; i++) {
            const obs = novelty[i] > 0 ? novelty[i] * normFactor : 0;
            
            let maxTransScore = -Infinity;
            let bestPrevBeat = -1;
            
            for (let lag = minSearch; lag <= maxSearch; lag++) {
                const prevBeat = i - lag;
                if (prevBeat < 0) continue;
                
                const penalty = -alpha * Math.pow(Math.log2(lag / beatPeriod), 2);
                const transScore = C[prevBeat] + penalty;
                
                if (transScore > maxTransScore) {
                    maxTransScore = transScore;
                    bestPrevBeat = prevBeat;
                }
            }
            
            if (bestPrevBeat === -1) {
                C[i] = obs;
                P[i] = -1;
            } else {
                C[i] = maxTransScore + obs;
                P[i] = bestPrevBeat;
            }
        }
        
        let bestLastBeat = -1;
        let maxC = -Infinity;
        for (let i = 0; i < novelty.length; i++) {
            if (C[i] > maxC) {
                maxC = C[i];
                bestLastBeat = i;
            }
        }
        
        const beats = [];
        let curr = bestLastBeat;
        while (curr !== -1) {
            beats.push(curr);
            curr = P[curr];
        }
        beats.reverse(); 
        
        const frameDuration = hopSize / sampleRate;
        if (beats.length > 0) {
            const firstBeatTime = beats[0] * frameDuration;
            state.phaseOffset = ((firstBeatTime % beatDuration) + beatDuration) % beatDuration;
        } else {
            state.phaseOffset = 0;
        }
        
        console.log(`[GraNotes] Phase Offset Applied (via DP Beat Tracking): ${state.phaseOffset.toFixed(3)} s`);

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
            // ★ 旧版(ゴールデンマスター)に完全一致させるため、チャンク区切りから phaseOffset を除去
            const chunkIdx = Math.floor(currentTime / CHUNK_DURATION);
            
            if (chunkIdx > currentChunkIndex) {
                chunks.push({
                    index: chunkIdx, startTime: chunkIdx * CHUNK_DURATION,
                    features: new Array(24).fill(0), notes: [], mappedTo: null, prngState: prng.getState()
                });
                currentChunkIndex = chunkIdx;
            }

            let l=0, m=0, h=0;
            for (let j = 0; j < hopSize && (i + j) < lowData.length; j++) { 
                l += lowData[i+j]*lowData[i+j]; m += midData[i+j]*midData[i+j]; h += highData[i+j]*highData[i+j]; 
            }
            l = Math.sqrt(l/hopSize); m = Math.sqrt(m/hopSize); h = Math.sqrt(h/hopSize);
            midRmsHistory.push({ time: currentTime, rms: m });

            const lDiff = l - prevLow; const mDiff = m - prevMid; const hDiff = h - prevHigh;
            const isLowHit = lDiff > 0.05 && l > 0.06; 
            const isMidHit = mDiff > config.diffThresh && m > config.absThresh; 
            const isHighHit = hDiff > 0.03 && h > 0.04;
            
            if (chunkIdx >= 0 && chunkIdx < chunks.length) {
                const chunk = chunks[chunkIdx];
                // ★ 旧版(ゴールデンマスター)に完全一致させるため、特徴量登録から phaseOffset を除去
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

        // ★ ノーツの抽出と間引き処理を旧版(ゴールデンマスター)のチャンク単位での実行へ完全復元
        let rawNotes = [];
        chunks.forEach((chunk) => {
            let sourceNotes = chunk.notes;
            if (chunk.mappedTo !== null) {
                const sourceChunk = chunks[chunk.mappedTo];
                const timeOffset = chunk.startTime - sourceChunk.startTime;
                sourceNotes = sourceChunk.notes.map(n => ({ time: n.time + timeOffset, pitch: n.pitch, seedVal: n.seedVal }));
            }
            
            let lastTime = -100;
            sourceNotes.forEach(note => {
                if (note.time - lastTime >= minIntervalSeconds) { 
                    rawNotes.push(note); 
                    lastTime = note.time; 
                }
            });
        });

        rawNotes.sort((a, b) => a.time - b.time);

        // --- 3. ノーツの統合と相対ピッチによる座標計算 ---
        const notesByMeasure = {};
        rawNotes.forEach(note => {
            const measureIndex = Math.floor(note.time / state.measureDuration);
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
            const measureIndex = Math.floor(time / state.measureDuration);
            const isTopRow = (measureIndex % 2 === 0); 
            
            let progressInMeasure = (time % state.measureDuration) / state.measureDuration;

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
                    (Math.floor(lastNode.time / state.measureDuration) === measureIndex) &&
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
        estimateBPM: estimateBPM,
        generateMap: generateMap
    };
})();