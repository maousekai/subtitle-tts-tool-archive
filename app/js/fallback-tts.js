/**
 * FallbackTTS - Web Speech API wrapper
 * Provides free, unlimited TTS as fallback when ElevenLabs credits are exhausted
 */
class FallbackTTS {
    constructor() {
        this.synth = window.speechSynthesis;
        this.voices = [];
        this.currentUtterance = null;
        this.isLoaded = false;
    }

    /**
     * Initialize and load available voices
     * @returns {Promise<SpeechSynthesisVoice[]>}
     */
    init() {
        return new Promise((resolve) => {
            const loadVoices = () => {
                this.voices = this.synth.getVoices();
                if (this.voices.length > 0) {
                    this.isLoaded = true;
                    resolve(this.voices);
                }
            };

            // Try loading immediately
            loadVoices();

            // Chrome loads voices asynchronously
            if (this.synth.onvoiceschanged !== undefined) {
                this.synth.onvoiceschanged = loadVoices;
            }

            // Timeout fallback
            setTimeout(() => {
                if (!this.isLoaded) {
                    this.voices = this.synth.getVoices();
                    this.isLoaded = true;
                    resolve(this.voices);
                }
            }, 1500);
        });
    }

    /**
     * Get all available voices, optionally filtered by language
     */
    getVoices(lang = null) {
        if (lang) {
            return this.voices.filter(v => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
        }
        return this.voices;
    }

    /**
     * Get Vietnamese voices
     */
    getVietnameseVoices() {
        return this.voices.filter(v => v.lang.startsWith('vi'));
    }

    /**
     * Get English voices
     */
    getEnglishVoices() {
        return this.voices.filter(v => v.lang.startsWith('en'));
    }

    /**
     * Speak text using Web Speech API
     * @param {string} text - Text to speak
     * @param {Object} options - Voice settings
     * @returns {Promise<void>}
     */
    speak(text, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.synth) {
                reject(new Error('Trình duyệt không hỗ trợ Speech Synthesis'));
                return;
            }

            this.stop();

            const utterance = new SpeechSynthesisUtterance(text);

            if (options.voice) utterance.voice = options.voice;
            if (options.rate !== undefined) utterance.rate = options.rate;
            if (options.pitch !== undefined) utterance.pitch = options.pitch;
            if (options.volume !== undefined) utterance.volume = options.volume;
            if (options.lang) utterance.lang = options.lang;

            utterance.onend = () => {
                this.currentUtterance = null;
                resolve();
            };

            utterance.onerror = (e) => {
                this.currentUtterance = null;
                // 'interrupted' is not a real error
                if (e.error === 'interrupted' || e.error === 'canceled') {
                    resolve();
                } else {
                    reject(new Error(`Speech error: ${e.error}`));
                }
            };

            this.currentUtterance = utterance;
            this.synth.speak(utterance);
        });
    }

    /**
     * Stop any current speech
     */
    stop() {
        if (this.synth.speaking || this.synth.pending) {
            this.synth.cancel();
        }
        this.currentUtterance = null;
    }

    /**
     * Pause current speech
     */
    pause() {
        if (this.synth.speaking && !this.synth.paused) {
            this.synth.pause();
        }
    }

    /**
     * Resume paused speech
     */
    resume() {
        if (this.synth.paused) {
            this.synth.resume();
        }
    }

    /**
     * Check if currently speaking
     */
    get isSpeaking() {
        return this.synth.speaking;
    }

    /**
     * Check if paused
     */
    get isPaused() {
        return this.synth.paused;
    }

    /**
     * Check if Web Speech API is supported
     */
    static isSupported() {
        return 'speechSynthesis' in window;
    }
}
