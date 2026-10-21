/**
 * TextOptimizer - Optimize text before sending to ElevenLabs API
 * Reduces character count to save credits
 */
class TextOptimizer {

    /**
     * Optimize text by cleaning whitespace and unnecessary characters
     * @param {string} text - Raw input text
     * @returns {string} Optimized text
     */
    static optimize(text) {
        if (!text) return '';

        let optimized = text;

        // Bỏ các thẻ mô tả âm thanh trong phụ đề (tiết kiệm token)
        optimized = optimized.replace(/\[.*?\]/g, ' ');   // Xóa [Nhạc]
        optimized = optimized.replace(/\(.*?\)/g, ' ');   // Xóa (Cười)
        optimized = optimized.replace(/\{.*?\}/g, ' ');   // Xóa {Tên}
        optimized = optimized.replace(/<.*?>/g, ' ');     // Xóa <Thở dài>
        optimized = optimized.replace(/\*.*?\*/g, ' ');   // Xóa *Sigh*
        optimized = optimized.replace(/[♫♪].*?[♫♪]/g, ' ');// Xóa ♫ Nhạc ♫

        // Normalize line endings
        optimized = optimized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Remove zero-width characters
        optimized = optimized.replace(/[\u200B-\u200D\u200E\u200F\uFEFF\u00AD]/g, '');

        // Normalize whitespace (tabs, form feeds, vertical tabs → space)
        optimized = optimized.replace(/[\t\f\v]+/g, ' ');

        // Collapse multiple spaces to single space
        optimized = optimized.replace(/ {2,}/g, ' ');

        // Remove emojis and other non-text symbols
        optimized = optimized.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
        optimized = optimized.replace(/[\u{1F300}-\u{1F5FF}]/gu, ''); // Misc Symbols and Pictographs
        optimized = optimized.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport and Map
        optimized = optimized.replace(/[\u{2600}-\u{26FF}]/gu, '');   // Misc symbols
        optimized = optimized.replace(/[\u{2700}-\u{27BF}]/gu, '');   // Dingbats

        // Collapse multiple newlines to double newline
        optimized = optimized.replace(/\n{3,}/g, '\n\n');

        // Trim each line
        optimized = optimized.split('\n').map(l => l.trim()).join('\n');

        // Remove leading/trailing whitespace
        optimized = optimized.trim();

        // If it's just punctuation/symbols, return empty (don't waste tokens reading "...!" or "-")
        if (/^[.,!?;:\-_'"`~@#$%^&*+=|\\\/\s]+$/.test(optimized)) {
            return '';
        }

        return optimized;
    }

    /**
     * Split long text into smaller chunks for efficient processing
     * Respects sentence boundaries when possible
     * @param {string} text - Text to split
     * @param {number} maxChars - Maximum characters per chunk (default 800)
     * @returns {string[]} Array of text chunks
     */
    static chunkText(text, maxChars = 800) {
        if (!text || text.length <= maxChars) return [text];

        const chunks = [];
        // Split by sentence endings (., !, ?, newlines) 
        const sentences = text.split(/(?<=[.!?。！？\n])\s*/);
        let currentChunk = '';

        for (const sentence of sentences) {
            if (!sentence.trim()) continue;

            if (sentence.length > maxChars) {
                // Sentence too long - split by clauses (commas, semicolons)
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = '';
                }
                const clauses = sentence.split(/(?<=[,;，；])\s*/);
                for (const clause of clauses) {
                    if ((currentChunk + clause).length > maxChars) {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        currentChunk = clause;
                    } else {
                        currentChunk += clause;
                    }
                }
            } else if ((currentChunk + ' ' + sentence).length > maxChars) {
                // Adding this sentence would exceed limit
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                // Add sentence to current chunk
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks.filter(c => c.length > 0);
    }

    /**
     * Count characters in text
     */
    static countChars(text) {
        return text ? text.length : 0;
    }

    /**
     * Strip HTML tags from text
     */
    static stripHtml(text) {
        return text ? text.replace(/<[^>]*>/g, '').trim() : '';
    }

    /**
     * Get optimization statistics comparing original vs optimized text
     */
    static getStats(original, optimized) {
        const originalLen = original ? original.length : 0;
        const optimizedLen = optimized ? optimized.length : 0;
        const saved = originalLen - optimizedLen;
        const percentage = originalLen > 0
            ? ((saved / originalLen) * 100).toFixed(1)
            : '0.0';

        return {
            original: originalLen,
            optimized: optimizedLen,
            saved,
            percentage
        };
    }

    /**
     * Estimate credits cost for text
     * @param {string} text - Text to estimate
     * @param {string} model - Model ID
     * @returns {number} Estimated character credits
     */
    static estimateCost(text, model = 'eleven_flash_v2_5') {
        const chars = this.countChars(text);
        // Flash models cost half the credits
        if (model.includes('flash')) {
            return Math.ceil(chars / 2);
        }
        return chars;
    }

    /**
     * Format number with comma separators
     */
    static formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
}
