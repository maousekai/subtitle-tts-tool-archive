/**
 * CacheManager - IndexedDB-based audio cache
 * Stores generated audio to avoid redundant API calls and save credits
 */
class CacheManager {
    constructor(dbName = 'ElevenLabsTTSCache') {
        this.dbName = dbName;
        this.storeName = 'audioCache';
        this.db = null;
        this.hitCount = 0;
        this.missCount = 0;
    }

    /**
     * Initialize the IndexedDB database
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    store.createIndex('voiceId', 'voiceId', { unique: false });
                }
            };
        });
    }

    /**
     * Generate a unique cache key based on text and settings
     * Uses SHA-256 hash for consistent key generation
     */
    async generateKey(text, voiceId, model, settings = {}) {
        const data = JSON.stringify({
            text: text.trim(),
            voiceId,
            model,
            stability: settings.stability,
            similarity: settings.similarity,
            style: settings.style,
            speed: settings.speed,
            speakerBoost: settings.speakerBoost
        });
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Get cached audio by key
     * @returns {Object|null} Cached record or null
     */
    async get(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) { resolve(null); return; }

            const tx = this.db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result || null;
                if (result) {
                    this.hitCount++;
                } else {
                    this.missCount++;
                }
                resolve(result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Store audio blob in cache
     */
    async set(key, audioBlob, metadata = {}) {
        return new Promise((resolve, reject) => {
            if (!this.db) { resolve(); return; }

            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);

            const record = {
                key,
                audio: audioBlob,
                createdAt: Date.now(),
                size: audioBlob.size,
                text: metadata.text || '',
                voiceId: metadata.voiceId || '',
                model: metadata.model || '',
                charCount: metadata.text ? metadata.text.length : 0
            };

            const request = store.put(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a single cache entry
     */
    async delete(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) { resolve(); return; }

            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all cached records
     */
    async getAll() {
        return new Promise((resolve, reject) => {
            if (!this.db) { resolve([]); return; }

            const tx = this.db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get cache statistics
     */
    async getStats() {
        const all = await this.getAll();
        const totalSize = all.reduce((sum, item) => sum + (item.size || 0), 0);
        const totalChars = all.reduce((sum, item) => sum + (item.charCount || 0), 0);

        return {
            count: all.length,
            totalSize,
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
            totalChars,
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRate: (this.hitCount + this.missCount) > 0
                ? ((this.hitCount / (this.hitCount + this.missCount)) * 100).toFixed(1)
                : 0,
            oldestDate: all.length
                ? new Date(Math.min(...all.map(i => i.createdAt)))
                : null
        };
    }

    /**
     * Clear all cached data
     */
    async clearAll() {
        return new Promise((resolve, reject) => {
            if (!this.db) { resolve(); return; }

            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => {
                this.hitCount = 0;
                this.missCount = 0;
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get session hit/miss stats (reset each session)
     */
    getSessionStats() {
        return {
            hits: this.hitCount,
            misses: this.missCount,
            total: this.hitCount + this.missCount,
            hitRate: (this.hitCount + this.missCount) > 0
                ? ((this.hitCount / (this.hitCount + this.missCount)) * 100).toFixed(1)
                : 0
        };
    }
}
