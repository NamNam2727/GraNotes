// --- 音声解析・譜面生成エンジン (analyzer.js) ---

window.GraNotes = window.GraNotes || {};

GraNotes.Analyzer = (function() {
    
    // =====================================================================
    // FFT (高速フーリエ変換) と Mel Filter Bank による本格的なMIR実装
    // =====================================================================
    class FFT {
        constructor(size) {
            this.size = size;
            this.cosTable = new Float32Array(size);
            this.sinTable = new Float32Array(size);
            for (let i = 0; i < size; i++) {
                this.cosTable[i] = Math.cos(-2 * Math.PI * i / size);
                this.sinTable[i] = Math.sin(-2 * Math.PI * i / size);
            }
            this.reverseTable = new Uint32Array(size);
            let limit = 1;
            let bit = size >> 1;
            while (limit < size) {
                for (let i = 0; i < limit; i++) {
                    this.reverseTable[i + limit] = this.reverseTable[i] + bit;
                }
                limit <<= 1;
                bit >>= 1;
            }
        }
        
        forward(real) {
            let size = this.size;
            let outR = new Float32Array(size);
            let outI = new Float32Array(size);
            for (let i = 0; i < size; i++) {
                outR[i] = real[this.reverseTable[i]];
                outI[i] = 0;
            }
            
            let halfSize = 1;
            while (halfSize < size) {
                let phaseShiftStepR = this.cosTable[size / (halfSize * 2)];
                let phaseShiftStepI = this.sinTable[size / (halfSize * 2)];
                
                for (let i = 0; i < size; i += halfSize * 2) {
                    let currentPhaseShiftR = 1;
                    let currentPhaseShiftI = 0;
                    for (let fftStep = 0; fftStep < halfSize; fftStep++) {
                        let idx1 = i + fftStep;
                        let idx2 = idx1 + halfSize;
                        let tr = (currentPhaseShiftR * outR[idx2]) - (currentPhaseShiftI * outI[idx2]);
                        let ti = (currentPhaseShiftR * outI[idx2]) + (currentPhaseShiftI * outR[idx2]);
                        outR[idx2] = outR[idx1] - tr;
                        outI[idx2] = outI[idx1] - ti;
                        outR[idx1] += tr;
                        outI[idx1] += ti;
                        
                        let tmpR = currentPhaseShiftR;
                        currentPhaseShiftR = (tmpR * phaseShiftStepR) - (currentPhaseShiftI * phaseShiftStepI);
                        currentPhaseShiftI = (tmpR * phaseShiftStepI) + (currentPhaseShiftI * phaseShiftStepR);
                    }
                }
                halfSize <<= 1;
            }
            
            let mag = new Float32Array(size / 2);
            for (let i = 0; i < size / 2; i++) {
                mag[i] = Math.sqrt(outR[i] * outR[i] + outI[i] * outI[i]);
            }
            return mag;
        }
    }

    function createMelFilterBank(sampleRate, fftSize, numBands) {
        const minFreq = 20;
        const maxFreq = sampleRate / 2;
        const melMin = 2595 * Math.log10(1 + minFreq / 700);
        const melMax = 2595 * Math.log10(1 + maxFreq / 700);
        const melPoints = new Float32Array(numBands + 2);
        for (let i = 0; i < melPoints.length; i++) {
            melPoints[i] = melMin + (melMax - melMin) * i / (numBands + 1);
        }
        const binPoints = new Int32Array(numBands + 2);
        for (let i = 0; i < melPoints.length; i++) {
            const hz = 700 * (Math.pow(10, melPoints[i] / 2595) - 1);
            binPoints[i] = Math.floor((fftSize) * hz / sampleRate);
        }
        
        const filters = [];
        for (let i = 0; i < numBands; i++) {
            const filter = new Float32Array(fftSize / 2);
            const start = binPoints[i];
            const center = binPoints[i + 1];
            const end = binPoints[i + 2];
            for (let j = start; j < center; j++) {
                if (center !== start) filter[j] = (j - start) / (center - start);
            }
            for (let j = center; j < end; j++) {
                if (end !== center) filter[j] = (end - j) / (end - center);
            }
            filters.push(filter);
        }
        return filters;
    }

    // Multi-band Onset Detection と Adaptive Threshold を用いた Novelty 生成
    function computeNovelty(buffer) {
        const sampleRate = buffer.sampleRate;
        const fftSize = 1024; // 約23ms (44.1kHz時)
        const hopSize = Math.floor(sampleRate * 0.01); // 10msステップ
        const numBands = 40; // 40分割のMel帯域
        const fft = new FFT(fftSize);
        const melFilters = createMelFilterBank(sampleRate, fftSize, numBands);
        const hannWindow = new Float32Array(fftSize);
        for(let i=0; i<fftSize; i++) hannWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));

        // モノラル化
        const monoData = new Float32Array(buffer.length);
        for(let c=0; c<buffer.numberOfChannels; c++) {
            const channelData = buffer.getChannelData(c);
            for(let i=0; i<buffer.length; i++) monoData[i] += channelData[i] / buffer.numberOfChannels;
        }

        const rawNovelty = [];
        let prevMel = new Float32Array(numBands);
        
        // FFT & Mel Spectral Flux
        for (let i = 0; i < monoData.length - fftSize; i += hopSize) {
            let frame = new Float32Array(fftSize);
            for (let j = 0; j < fftSize; j++) {
                frame[j] = monoData[i + j] * hannWindow[j];
            }
            let mag = fft.forward(frame);
            let flux = 0;
            for (let b = 0; b < numBands; b++) {
                let sum = 0;
                for (let j = 0; j < mag.length; j++) {
                    sum += mag[j] * melFilters[b][j];
                }
                // 対数圧縮によるダイナミクス調整
                let logVal = Math.log10(1 + 100 * sum);
                let diff = logVal - prevMel[b];
                // 半波整流 (立ち上がりのみ抽出)
                if (diff > 0) flux += diff;
                prevMel[b] = logVal;
            }
            rawNovelty.push(flux);
        }
        
        // 既存の譜面生成ロジック(OfflineContext)と長さを完全に同期させるためのパディング
        const expectedLength = Math.ceil(monoData.length / hopSize);
        while (rawNovelty.length < expectedLength) {
            rawNovelty.push(0);
        }

        // Adaptive Thresholding (局所的な移動平均を引くことで定常音をカットしアタックだけを残す)
        const novelty = new Float32Array(rawNovelty.length);
        const windowSize = 5; // 前後5フレーム(±50ms)の移動平均
        let noveltySum = 0;
        for (let i = 0; i < rawNovelty.length; i++) {
            let sum = 0, count = 0;
            for (let w = -windowSize; w <= windowSize; w++) {
                if (i + w >= 0 && i + w < rawNovelty.length) {
                    sum += rawNovelty[i + w];
                    count++;
                }
            }
            const threshold = sum / count;
            let val = rawNovelty[i] - threshold;
            val = val > 0 ? val : 0; // 閾値以下は0
            novelty[i] = val;
            noveltySum += val;
        }

        // 自己相関(ACF)のベースライン安定化のための Mean Subtraction
        const noveltyMean = noveltySum / novelty.length;
        for (let i = 0; i < novelty.length; i++) {
            novelty[i] -= noveltyMean;
        }

        return novelty;
    }
    // =====================================================================

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

    // ★ プレビュー時のBPM自動推定 (FFTベースに置き換え)
    async function estimateBPM(buffer) {
        const sampleRate = buffer.sampleRate;
        const hopSize = Math.floor(sampleRate * 0.01); 
        
        // FFTベースのMel Spectral Fluxで高品質なNoveltyを生成
        const novelty = computeNovelty(buffer);
        const frameRate = sampleRate / hopSize; 

        // ★ 15秒ごとの区間（チャンク）に分割して独立してBPMを推定する
        const segmentDuration = 15.0; 
        const framesPerSegment = Math.floor(segmentDuration * frameRate);
        const numSegments = Math.max(1, Math.floor(novelty.length / framesPerSegment));
        const estimatedBpms = [];

        for (let segIdx = 0; segIdx < numSegments; segIdx++) {
            const startFrame = segIdx * framesPerSegment;
            const endFrame = Math.min(startFrame + framesPerSegment, novelty.length);
            const novelty_seg = novelty.slice(startFrame, endFrame);
            
            function calcAcfAtLag(l) {
                const lInt = Math.floor(l);
                const lFrac = l - lInt;
                let acf = 0;
                let count = 0;
                const maxI = novelty_seg.length - lInt - 1;
                
                for (let i = 0; i < maxI; i++) {
                    const delayed = novelty_seg[i + lInt] * (1 - lFrac) + novelty_seg[i + lInt + 1] * lFrac;
                    acf += novelty_seg[i] * delayed;
                    count++;
                }
                return count > 0 ? acf / count : 0;
            }

            const variance = calcAcfAtLag(0) || 1;
            
            let maxScore = -Infinity;
            let bestIdx = -1;
            const scores = [];
            
            let i = 0;
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

                scores.push(finalScore);
                if (finalScore > maxScore) {
                    maxScore = finalScore;
                    bestIdx = i;
                }
                i++;
            }
            
            // ★ 放物線ピーク補間 (Parabolic Peak Interpolation)
            // ACFの最大スコアの前後を用いて、小数点のさらに細かい真のピークを割り出す
            let p = 0;
            if (bestIdx > 0 && bestIdx < scores.length - 1) {
                const s1 = scores[bestIdx - 1];
                const s2 = scores[bestIdx];
                const s3 = scores[bestIdx + 1];
                const denom = (s1 - 2 * s2 + s3);
                if (denom !== 0) {
                    p = 0.5 * (s1 - s3) / denom;
                }
            }
            
            const trueIdx = bestIdx + p;
            const segBpm = 70 + trueIdx * 0.1;
            estimatedBpms.push(segBpm);
        }
        
        // ★ 各区間で推定されたBPMの中央値(Median)を採用し、外れ値を除外
        estimatedBpms.sort((a, b) => a - b);
        let bestBpm = 120;
        if (estimatedBpms.length > 0) {
            if (estimatedBpms.length % 2 === 0) {
                bestBpm = (estimatedBpms[estimatedBpms.length / 2 - 1] + estimatedBpms[estimatedBpms.length / 2]) / 2;
            } else {
                bestBpm = estimatedBpms[Math.floor(estimatedBpms.length / 2)];
            }
        }
        
        let calculatedBpm = Math.round(bestBpm);
        
        if (calculatedBpm <= 90) {
            calculatedBpm *= 2;
        }
        
        // ★ 10刻みのスナップ処理を撤廃し、ピーク補間で得られた微細なBPM(151や174など)を優先・尊重する

        return calculatedBpm;
    }

    async function generateMap(buffer, minIntervalBeat, maxSliderIntervalBeat, manualBpm) {
        const state = GraNotes.State;
        const config = GraNotes.ENGINE_CONFIG;
        
        const duration = buffer.duration; 
        const sampleRate = buffer.sampleRate;
        
        // ★譜面生成に必須の処理はそのまま維持する
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

        // ★ 新規追加: BPM推定用のMel Spectral Fluxを計算
        const novelty = computeNovelty(buffer);


        // --- 1. BPM設定 (手動指定 or 自動推定) ---
        let beatDuration = 0.5;

        if (manualBpm && manualBpm > 0) {
            state.bpm = manualBpm;
            beatDuration = 60 / state.bpm;
            console.log(`[GraNotes] BPM Applied (Manual): ${state.bpm}`);
        } else {
            const frameRate = sampleRate / hopSize; 

            // ★ 15秒ごとの区間（チャンク）に分割して独立してBPMを推定する
            const segmentDuration = 15.0; 
            const framesPerSegment = Math.floor(segmentDuration * frameRate);
            const numSegments = Math.max(1, Math.floor(novelty.length / framesPerSegment));
            const estimatedBpms = [];

            for (let segIdx = 0; segIdx < numSegments; segIdx++) {
                const startFrame = segIdx * framesPerSegment;
                const endFrame = Math.min(startFrame + framesPerSegment, novelty.length);
                const novelty_seg = novelty.slice(startFrame, endFrame);
                
                function calcAcfAtLag(l) {
                    const lInt = Math.floor(l);
                    const lFrac = l - lInt;
                    let acf = 0;
                    let count = 0;
                    const maxI = novelty_seg.length - lInt - 1;
                    
                    for (let i = 0; i < maxI; i++) {
                        const delayed = novelty_seg[i + lInt] * (1 - lFrac) + novelty_seg[i + lInt + 1] * lFrac;
                        acf += novelty_seg[i] * delayed;
                        count++;
                    }
                    return count > 0 ? acf / count : 0;
                }

                const variance = calcAcfAtLag(0) || 1;
                
                let maxScore = -Infinity;
                let bestIdx = -1;
                const scores = [];
                
                let i = 0;
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

                    scores.push(finalScore);
                    if (finalScore > maxScore) {
                        maxScore = finalScore;
                        bestIdx = i;
                    }
                    i++;
                }
                
                // ★ 放物線ピーク補間 (Parabolic Peak Interpolation)
                let p = 0;
                if (bestIdx > 0 && bestIdx < scores.length - 1) {
                    const s1 = scores[bestIdx - 1];
                    const s2 = scores[bestIdx];
                    const s3 = scores[bestIdx + 1];
                    const denom = (s1 - 2 * s2 + s3);
                    if (denom !== 0) {
                        p = 0.5 * (s1 - s3) / denom;
                    }
                }
                
                const trueIdx = bestIdx + p;
                const segBpm = 70 + trueIdx * 0.1;
                estimatedBpms.push(segBpm);
            }
            
            // ★ 各区間で推定されたBPMの中央値(Median)を採用し、外れ値を除外
            estimatedBpms.sort((a, b) => a - b);
            let bestBpm = 120;
            if (estimatedBpms.length > 0) {
                if (estimatedBpms.length % 2 === 0) {
                    bestBpm = (estimatedBpms[estimatedBpms.length / 2 - 1] + estimatedBpms[estimatedBpms.length / 2]) / 2;
                } else {
                    bestBpm = estimatedBpms[Math.floor(estimatedBpms.length / 2)];
                }
            }
            
            let calculatedBpm = Math.round(bestBpm);
            
            if (calculatedBpm <= 90) {
                console.log(`[GraNotes] Detected BPM (${calculatedBpm}) is too slow. Doubling the BPM.`);
                calculatedBpm *= 2;
            }
            
            // ★ 10刻みのスナップ処理を撤廃し、ピーク補間で得られた微細なBPM(151や174など)を優先・尊重する
            
            state.bpm = calculatedBpm;
            beatDuration = 60 / state.bpm;
            console.log(`[GraNotes] BPM Applied (Auto via FFT SpectralFlux): ${state.bpm}`);
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

        // ============================================================================
        // ここから下の譜面生成ロジックは一切変更していません (旧版完全維持)
        // ============================================================================

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
            
            if (chunkIdx >= 0 && chunkIdx < chunks.length) {
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

        // 完全に時間順に並べ替える
        allNotes.sort((a, b) => a.time - b.time);

        // 並べ替え後に間引きを行う（チャンク境界の重複・逆走を完全に排除）
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
            
            // 剰余(%)を使わずに進行度を計算し、範囲を確実に0.0〜1.0に収める（逆走バグ防止済）
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
        estimateBPM: estimateBPM,
        generateMap: generateMap
    };
})();