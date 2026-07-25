// --- グローバル設定と変数 ---

window.GraNotes = window.GraNotes || {};

// 解析エンジンのパラメータ（確定版）
GraNotes.ENGINE_CONFIG = {
    freq: 800,           // 中心周波数 Hz
    q: 0.5,              // 帯域幅 (Q値)
    diffThresh: 0.03,    // 変化量しきい値
    absThresh: 0.095,    // 絶対音量しきい値
    sustainThresh: 0.03  // 音の持続しきい値 RMS
};

// 難易度設定 (minIntervalBeat: 最小ノーツ間隔の拍数)
// 結合間隔はこの数値の3倍として後続のロジックで計算されます
GraNotes.DIFFICULTIES = {
    easy:    { label: "かんたん",   value: 1.0 },
    normal:  { label: "ふつう",     value: 0.5 },
    hard:    { label: "むずかしい", value: 0.25 },
    extreme: { label: "げきむず",   value: 0.125 }
};

// アプリケーション全体で共有する状態変数
GraNotes.State = {
    audioContext: null,
    audioBuffer: null,
    playSource: null,
    generatedNotes: [],
    
    startTime: 0,
    animationId: null,
    isPlaying: false,
    
    bpm: 120,
    measureDuration: 2.0, // 1小節の秒数
    
    // スコア関連
    score: 0,
    combo: 0,
    maxCombo: 0,
    stats: { perfect: 0, good: 0, miss: 0 }
};

// 乱数生成器（※ノーツの細かなY軸の散らしや、将来的な演出用）
GraNotes.XorShift = class {
    constructor(seed) { 
        this.x = 123456789; this.y = 362436069; this.z = 521288629; this.w = seed || 88675123; 
    }
    next() {
        let t = this.x ^ (this.x << 11); this.x = this.y; this.y = this.z; this.z = this.w;
        this.w = (this.w ^ (this.w >>> 19)) ^ (t ^ (t >>> 8)); return Math.abs(this.w) / 0x7FFFFFFF;
    }
    getState() { return { x: this.x, y: this.y, z: this.z, w: this.w }; }
    setState(state) { this.x = state.x; this.y = state.y; this.z = state.z; this.w = state.w; }
};


