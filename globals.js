// --- グローバル設定と変数 ---

window.GraNotes = window.GraNotes || {};

GraNotes.ENGINE_CONFIG = {
    freq: 800,           
    q: 0.3,              
    diffThresh: 0.03,    
    absThresh: 0.095,    
    sustainThresh: 0.03  
};

GraNotes.DIFFICULTIES = {
    easy:    { label: "かんたん",   value: 1.0 },
    normal:  { label: "ふつう",     value: 0.5 },
    hard:    { label: "むずかしい", value: 0.25 },
    extreme: { label: "げきむず",   value: 0.125 }
};

GraNotes.State = {
    audioContext: null,
    audioBuffer: null,
    playSource: null,
    generatedNotes: [],
    
    startTime: 0,
    animationId: null,
    isPlaying: false,
    
    bpm: 120,
    measureDuration: 2.0, 
    
    score: 0,
    combo: 0,
    maxCombo: 0,
    stats: { perfect: 0, good: 0, miss: 0 },

    // ★ 現在選択されている曲のインデックスを保持
    selectedMusicIndex: 0 
};

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


