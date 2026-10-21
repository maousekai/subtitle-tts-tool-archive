/**
 * BatchProcessor - Process multiple subtitles sequentially
 * Handles queue management, progress tracking, pause/resume, and auto-retry
 */
class BatchProcessor extends EventTarget {
    constructor(api, cacheManager) {
        super();
        this.api = api;
        this.cache = cacheManager;

        this.items = [];
        this.isRunning = false;
        this.isPaused = false;
        this.isCancelled = false;
        this.currentIndex = -1;
        this.startTime = null;
        this.totalCharsUsed = 0;
        this.totalCharsSaved = 0;
    }

    /**
     * Set subtitle items to process
     * @param {Array} subtitles - Parsed subtitle objects
     */
    setItems(subtitles) {
        this.items = subtitles.map((sub, index) => ({
            ...sub,
            id: index,
            status: 'pending',      // pending | processing | done | error | skipped
            audioBlob: null,
            audioDuration: 0,
            error: null,
            fromCache: false,
            retryCount: 0
        }));
        this.emit('itemsLoaded', { items: this.items, stats: this.getStats() });
    }

    /**
     * Get all items
     */
    getItems() {
        return this.items;
    }

    /**
     * Get a specific item by index
     */
    getItem(index) {
        return this.items[index] || null;
    }

    /**
     * Get processing statistics
     */
    getStats() {
        const done = this.items.filter(i => i.status === 'done').length;
        const errors = this.items.filter(i => i.status === 'error').length;
        const pending = this.items.filter(i => i.status === 'pending').length;
        const processing = this.items.filter(i => i.status === 'processing').length;
        const skipped = this.items.filter(i => i.status === 'skipped').length;
        const cacheHits = this.items.filter(i => i.fromCache).length;
        const elapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;

        return {
            total: this.items.length,
            done,
            errors,
            pending,
            processing,
            skipped,
            cacheHits,
            elapsed: Math.round(elapsed),
            elapsedFormatted: this.formatElapsed(elapsed),
            charsUsed: this.totalCharsUsed,
            charsSaved: this.totalCharsSaved,
            progress: this.items.length > 0 ? ((done + skipped) / this.items.length) * 100 : 0,
            isRunning: this.isRunning,
            isPaused: this.isPaused
        };
    }

    /**
     * Start batch processing
     * @param {string} voiceId - Voice ID to use
     * @param {Object} settings - Voice settings
     */
    async start(voiceId, settings = {}) {
        if (this.isRunning) return;
        if (this.items.length === 0) {
            this.emit('error', { message: 'Không có subtitle nào để xử lý.' });
            return;
        }

        this.isRunning = true;
        this.isPaused = false;
        this.isCancelled = false;

        // Only reset startTime if starting fresh
        if (!this.startTime || this.items.every(i => i.status === 'pending')) {
            this.startTime = Date.now();
            this.totalCharsUsed = 0;
            this.totalCharsSaved = 0;
        }

        this.emit('batchStart', this.getStats());

        for (let i = 0; i < this.items.length; i++) {
            // Check for cancel
            if (this.isCancelled) break;

            // Wait while paused
            while (this.isPaused && !this.isCancelled) {
                await new Promise(r => setTimeout(r, 200));
            }
            if (this.isCancelled) break;

            // Skip already completed items
            if (this.items[i].status === 'done' || this.items[i].status === 'skipped') continue;

            this.currentIndex = i;
            this.items[i].status = 'processing';
            this.emit('itemProgress', { index: i, item: this.items[i], stats: this.getStats() });

            try {
                await this.processItem(i, voiceId, settings);
                this.items[i].status = 'done';
            } catch (error) {
                this.items[i].status = 'error';
                this.items[i].error = error.message;
                console.error(`Error processing item ${i}:`, error);
            }

            this.emit('itemProgress', { index: i, item: this.items[i], stats: this.getStats() });

            // Small delay between API calls to respect rate limits
            if (!this.items[i].fromCache && i < this.items.length - 1 && this.items[i].status === 'done') {
                await new Promise(r => setTimeout(r, 350));
            }
        }

        this.isRunning = false;
        this.currentIndex = -1;
        this.emit('batchComplete', this.getStats());
    }

    /**
     * Process a single item
     */
    async processItem(index, voiceId, settings) {
        const item = this.items[index];
        const optimizedText = TextOptimizer.optimize(item.text);

        if (!optimizedText) {
            item.status = 'skipped';
            return;
        }

        // Generate cache key
        const cacheKey = await this.cache.generateKey(
            optimizedText, voiceId, settings.model, settings
        );

        // Check cache first
        const cached = await this.cache.get(cacheKey);

        if (cached && cached.audio) {
            // Cache hit! No API call needed
            item.audioBlob = cached.audio;
            item.fromCache = true;
            item.audioDuration = await this.getAudioDuration(cached.audio);
            this.totalCharsSaved += optimizedText.length;
            return;
        }

        // Cache miss - call ElevenLabs API
        if (!this.api.hasApiKey()) {
            throw new Error('Chưa cấu hình API key');
        }

        const audioBlob = await this.api.textToSpeech(optimizedText, voiceId, settings);

        item.audioBlob = audioBlob;
        item.audioDuration = await this.getAudioDuration(audioBlob);
        this.totalCharsUsed += optimizedText.length;

        // Save to cache for future use
        await this.cache.set(cacheKey, audioBlob, {
            text: optimizedText,
            voiceId,
            model: settings.model
        });
    }

    /**
     * Pause processing
     */
    pause() {
        if (this.isRunning) {
            this.isPaused = true;
            this.emit('batchPaused', this.getStats());
        }
    }

    /**
     * Resume processing
     */
    resume() {
        if (this.isPaused) {
            this.isPaused = false;
            this.emit('batchResumed', this.getStats());
        }
    }

    /**
     * Cancel processing
     */
    cancel() {
        this.isCancelled = true;
        this.isPaused = false;
        this.isRunning = false;
        this.emit('batchCancelled', this.getStats());
    }

    /**
     * Reset all items to pending
     */
    reset() {
        this.cancel();
        this.items.forEach(item => {
            item.status = 'pending';
            item.audioBlob = null;
            item.audioDuration = 0;
            item.error = null;
            item.fromCache = false;
            item.retryCount = 0;
        });
        this.startTime = null;
        this.totalCharsUsed = 0;
        this.totalCharsSaved = 0;
        this.currentIndex = -1;
        this.emit('batchReset', this.getStats());
    }

    /**
     * Retry failed items
     */
    async retryFailed(voiceId, settings) {
        this.items.forEach(item => {
            if (item.status === 'error') {
                item.status = 'pending';
                item.error = null;
                item.retryCount++;
            }
        });
        await this.start(voiceId, settings);
    }

    /**
     * Get audio duration from blob
     */
    getAudioDuration(blob) {
        return new Promise((resolve) => {
            const audio = new Audio();
            const url = URL.createObjectURL(blob);

            audio.addEventListener('loadedmetadata', () => {
                resolve(audio.duration || 0);
                URL.revokeObjectURL(url);
            });

            audio.addEventListener('error', () => {
                resolve(0);
                URL.revokeObjectURL(url);
            });

            audio.src = url;
        });
    }

    /**
     * Format elapsed seconds to HH:MM:SS
     */
    formatElapsed(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    /**
     * Get all completed audio blobs (in order)
     */
    getCompletedAudio() {
        return this.items
            .filter(i => i.status === 'done' && i.audioBlob)
            .map(i => ({
                index: i.index,
                text: i.text,
                blob: i.audioBlob,
                duration: i.audioDuration
            }));
    }

    /**
     * Emit custom event
     */
    emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
}
