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

        // --- 1. BPM設定 (手動指定 or 自動推定) ---
        let beatDuration = 0.5;

        if (manualBpm && manualBpm > 0) {
            state.bpm = manualBpm;
            beatDuration = 60 / state.bpm;
            console.log(`[GraNotes] BPM Applied (Manual): ${state.bpm}`);
        } else {
            let tempOnsets = []; let tempPrevLow = 0, tempPrevMid = 0, tempPrevHigh = 0;
            for (let i = 0; i < lowData.length; i += hopSize) {
                let l=0, m=0, h=0;
                for (let j = 0; j < hopSize && (i + j) < lowData.length; j++) { 
                    l += lowData[i+j]*lowData[i+j]; m += midData[i+j]*midData[i+j]; h += highData[i+j]*highData[i+j]; 
                }
                l = Math.sqrt(l/hopSize); m = Math.sqrt(m/hopSize); h = Math.sqrt(h/hopSize);
                if ((l - tempPrevLow > 0.04 && l > 0.05) || (m - tempPrevMid > 0.02 && m > 0.035) || (h - tempPrevHigh > 0.03 && h > 0.04)) {
                    tempOnsets.push(i / sampleRate);
                }
                tempPrevLow = l; tempPrevMid = m; tempPrevHigh = h;
            }
            
            let intervals = [];
            for(let i=0; i<tempOnsets.length; i++) {
                for(let j=1; j<=4 && i+j < tempOnsets.length; j++) { 
                    let diff = tempOnsets[i+j] - tempOnsets[i]; if(diff >= 0.2 && diff <= 1.5) intervals.push(diff);
                }
            }
            
            // ★ 解析の精度を0.01秒から0.005秒（5ミリ秒）に向上
            let histogram = {}; 
            const BIN_SIZE = 0.005; 
            
            intervals.forEach(int => { 
                let bin = Math.round(int / BIN_SIZE); 
                histogram[bin] = (histogram[bin] || 0) + 1; 
            });
            
            let maxCount = 0, bestBinIndex = 80;
            for(let bin in histogram) { 
                if(histogram[bin] > maxCount) { 
                    maxCount = histogram[bin]; 
                    bestBinIndex = parseInt(bin); 
                } 
            }
            
            let sumWeights = 0; let sumValues = 0;
            // ★ 頂点だけでなく、±2ビン（計5ビン）の広い範囲で加重平均をとることでブレを吸収
            for(let i = bestBinIndex - 2; i <= bestBinIndex + 2; i++) {
                if(histogram[i]) { 
                    sumWeights += histogram[i]; 
                    sumValues += histogram[i] * (i * BIN_SIZE); 
                }
            }
            
            beatDuration = sumWeights > 0 ? sumValues / sumWeights : (bestBinIndex * BIN_SIZE);
            
            // ★ テンポが極端に速い場合（約181BPM以上）は、半分のテンポとして解釈する
            if (beatDuration < 0.33) beatDuration *= 2; 

            let calculatedBpm = Math.round(60 / beatDuration);
            
            // ★ 149や151など「5の倍数」からわずかに1だけズレた場合は、5の倍数に吸着（スナップ）させる
            if (calculatedBpm % 5 === 1) calculatedBpm -= 1;
            if (calculatedBpm % 5 === 4) calculatedBpm += 1;

            state.bpm = calculatedBpm;
            beatDuration = 60 / state.bpm;
            console.log(`[GraNotes] BPM Applied (Auto): ${state.bpm}`);
        }

        state.measureDuration = beatDuration * 4; 
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
            
            let progressInMeasure = (time - (measureIndex * state.measureDuration)) / state.measureDuration;
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
        generateMap: generateMap
    };
})();


