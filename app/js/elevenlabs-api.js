/**
 * ElevenLabsAPI - Wrapper for ElevenLabs REST API
 * Handles authentication, rate limiting, and error recovery
 */
class ElevenLabsAPI {
    constructor() {
        this.baseUrl = 'https://api.elevenlabs.io/v1';
        this.apiKey = localStorage.getItem('elevenlabs_api_key') || '';
        this.retryDelay = 1000; // Base retry delay in ms
        this.maxRetries = 3;
    }

    // ============ API Key Management ============

    setApiKey(key) {
        this.apiKey = key.trim();
        localStorage.setItem('elevenlabs_api_key', this.apiKey);
    }

    getApiKey() {
        return this.apiKey;
    }

    hasApiKey() {
        return !!this.apiKey && this.apiKey.length > 0;
    }

    clearApiKey() {
        this.apiKey = '';
        localStorage.removeItem('elevenlabs_api_key');
    }

    // ============ HTTP Helpers ============

    getHeaders(contentType = 'application/json') {
        const headers = {
            'xi-api-key': this.apiKey
        };
        if (contentType) {
            headers['Content-Type'] = contentType;
        }
        return headers;
    }

    /**
     * Make an API request with retry logic and error handling
     */
    async request(endpoint, options = {}, retries = 0) {
        if (!this.hasApiKey()) {
            throw new Error('API key chưa được cấu hình. Vui lòng nhập API key.');
        }

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                    ...this.getHeaders(),
                    ...options.headers
                }
            });

            // Handle rate limiting (429)
            if (response.status === 429) {
                if (retries < this.maxRetries) {
                    const delay = this.retryDelay * Math.pow(2, retries);
                    console.warn(`Rate limited. Retrying in ${delay}ms... (attempt ${retries + 1}/${this.maxRetries})`);
                    await new Promise(r => setTimeout(r, delay));
                    return this.request(endpoint, options, retries + 1);
                }
                throw new Error('Bị giới hạn tốc độ (rate limit). Vui lòng đợi và thử lại.');
            }

            // Handle authentication errors
            if (response.status === 401) {
                throw new Error('API key không hợp lệ. Vui lòng kiểm tra lại.');
            }

            // Handle quota exceeded
            if (response.status === 403) {
                throw new Error('Hết credits hoặc không có quyền truy cập.');
            }

            // Handle other errors
            if (!response.ok) {
                let errorMsg = `API Error: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.detail?.message || errorData.detail || errorMsg;
                } catch (e) { /* ignore json parse error */ }
                throw new Error(errorMsg);
            }

            return response;

        } catch (error) {
            // Network errors
            if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('network'))) {
                throw new Error('Lỗi mạng. Vui lòng kiểm tra kết nối internet.');
            }
            throw error;
        }
    }

    // ============ API Methods ============

    /**
     * Get list of available voices
     * @returns {Array} List of voice objects
     */
    async getVoices() {
        const response = await this.request('/voices');
        const data = await response.json();
        return data.voices || [];
    }

    /**
     * Get available TTS models
     * @returns {Array} List of model objects
     */
    async getModels() {
        const response = await this.request('/models');
        return await response.json() || [];
    }

    /**
     * Get subscription/usage info
     * @returns {Object} Subscription details including credits
     */
    async getSubscription() {
        const response = await this.request('/user/subscription');
        const data = await response.json();

        return {
            tier: data.tier || 'free',
            characterCount: data.character_count || 0,
            characterLimit: data.character_limit || 0,
            charactersRemaining: (data.character_limit || 0) - (data.character_count || 0),
            nextResetDate: data.next_character_count_reset_unix
                ? new Date(data.next_character_count_reset_unix * 1000)
                : null,
            voiceLimit: data.voice_limit || 0,
            canUseInstantVoiceCloning: data.can_use_instant_voice_cloning || false,
            canExtendCharacterLimit: data.can_extend_character_limit || false
        };
    }

    /**
     * Convert text to speech
     * @param {string} text - Text to convert
     * @param {string} voiceId - Voice ID to use
     * @param {Object} settings - Voice and output settings
     * @returns {Blob} Audio blob (MP3)
     */
    async textToSpeech(text, voiceId, settings = {}) {
        const {
            model = 'eleven_flash_v2_5',
            stability = 0.5,
            similarity = 0.75,
            style = 0,
            speakerBoost = true,
            speed = 1.0,
            languageCode = null,
            outputFormat = 'mp3_44100_128'
        } = settings;

        const body = {
            text,
            model_id: model,
            voice_settings: {
                stability: parseFloat(stability),
                similarity_boost: parseFloat(similarity),
                style: parseFloat(style),
                use_speaker_boost: speakerBoost
            }
        };

        // Add speed if not default
        if (speed && speed !== 1.0) {
            body.voice_settings.speed = parseFloat(speed);
        }

        // Add language override if specified
        if (languageCode) {
            body.language_code = languageCode;
        }

        const response = await this.request(
            `/text-to-speech/${voiceId}?output_format=${outputFormat}`,
            {
                method: 'POST',
                body: JSON.stringify(body)
            }
        );

        return await response.blob();
    }

    /**
     * Verify API connection and return subscription info
     * @returns {Object} { success: boolean, subscription?: Object, error?: string }
     */
    async verifyConnection() {
        try {
            const subscription = await this.getSubscription();
            return { success: true, subscription };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get user info
     */
    async getUserInfo() {
        const response = await this.request('/user');
        return await response.json();
    }
}
