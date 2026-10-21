/**
 * Google Cloud TTS API Handler
 */
class GoogleTTSApi {
    constructor() {
        this.apiKey = localStorage.getItem('google_tts_api_key') || '';
        this.baseUrl = 'https://texttospeech.googleapis.com/v1';
    }

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('google_tts_api_key', key);
    }

    getApiKey() {
        return this.apiKey;
    }

    hasApiKey() {
        return !!this.apiKey;
    }

    async verifyConnection() {
        try {
            await this.getVoices();
            return { 
                success: true, 
                subscription: { 
                    tier: 'Google Cloud (Free)', 
                    characterCount: 0, 
                    characterLimit: 1000000,
                    nextResetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
                } 
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Get available voices
     */
    async getVoices() {
        if (!this.apiKey) throw new Error('Chưa cấu hình Google Cloud API Key');
        
        try {
            const response = await fetch(`${this.baseUrl}/voices?key=${this.apiKey}`);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || 'Lỗi khi lấy danh sách voice Google');
            }
            const data = await response.json();
            return data.voices;
        } catch (error) {
            console.error('Lỗi getVoices Google:', error);
            throw error;
        }
    }

    /**
     * Synthesize speech
     */
    async synthesize(text, options = {}) {
        if (!this.apiKey) throw new Error('Chưa cấu hình Google Cloud API Key');

        const voiceName = options.voice_id || 'en-US-Journey-D';
        const languageCode = voiceName.substring(0, 5); // e.g. en-US, vi-VN

        // Elevenlabs slider is 0 to 1, map stability to pitch (-20 to 20)
        // Or speed is 0.5 to 2.0
        const speed = options.speed || 1.0;
        
        // We can just ignore pitch and volume for simplicity or use default 0
        const pitch = 0.0;

        const body = {
            input: { text: text },
            voice: { 
                languageCode: languageCode,
                name: voiceName 
            },
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: speed,
                pitch: pitch,
                volumeGainDb: 0.0
            }
        };

        try {
            const response = await fetch(`${this.baseUrl}/text:synthesize?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || `Lỗi API Google TTS: ${response.status}`);
            }

            const data = await response.json();
            
            // Decode base64 to Blob
            const binaryString = window.atob(data.audioContent);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            return new Blob([bytes], { type: 'audio/mp3' });
        } catch (error) {
            console.error('Google TTS error:', error);
            throw error;
        }
    }

    /**
     * Alias for compatibility with ElevenLabsAPI
     */
    async textToSpeech(text, voiceId, settings) {
        return this.synthesize(text, { ...settings, voice_id: voiceId });
    }
}

window.GoogleTTS = new GoogleTTSApi();
