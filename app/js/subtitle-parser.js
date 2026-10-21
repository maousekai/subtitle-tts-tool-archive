/**
 * SubtitleParser - Parse various subtitle file formats
 * Supports: SRT, ASS/SSA, VTT, TXT
 */
class SubtitleParser {

    /**
     * Parse subtitle content based on file type
     * @param {string} content - Raw file content
     * @param {string} fileType - File extension (srt, ass, vtt, txt)
     * @returns {Array<{index: number, startTime: number, endTime: number, text: string}>}
     */
    static parse(content, fileType) {
        const type = fileType.toLowerCase().replace('.', '');
        switch (type) {
            case 'srt': return this.parseSRT(content);
            case 'ass':
            case 'ssa': return this.parseASS(content);
            case 'vtt': return this.parseVTT(content);
            case 'txt': return this.parseTXT(content);
            default: throw new Error(`Định dạng không hỗ trợ: .${fileType}`);
        }
    }

    /**
     * Parse SRT (SubRip) format
     */
    static parseSRT(content) {
        const blocks = content.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
        const subtitles = [];

        for (const block of blocks) {
            const lines = block.trim().split('\n');
            if (lines.length < 2) continue;

            // Find the timestamp line (contains -->)
            let timeLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) {
                    timeLineIndex = i;
                    break;
                }
            }

            if (timeLineIndex === -1) continue;

            const timeParts = lines[timeLineIndex].split('-->');
            if (timeParts.length !== 2) continue;

            const startTime = this.parseSRTTime(timeParts[0].trim());
            const endTime = this.parseSRTTime(timeParts[1].trim());
            const text = lines.slice(timeLineIndex + 1).join('\n').trim();

            if (text) {
                subtitles.push({
                    index: subtitles.length + 1,
                    startTime,
                    endTime,
                    text: this.cleanText(text)
                });
            }
        }

        return subtitles;
    }

    /**
     * Parse ASS/SSA (Advanced SubStation Alpha) format
     */
    static parseASS(content) {
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const subtitles = [];
        let inEvents = false;
        let formatFields = [];

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed === '[Events]') {
                inEvents = true;
                continue;
            }

            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                inEvents = false;
                continue;
            }

            if (inEvents && trimmed.startsWith('Format:')) {
                formatFields = trimmed.replace('Format:', '').split(',').map(f => f.trim());
                continue;
            }

            if (inEvents && trimmed.startsWith('Dialogue:')) {
                const rawValues = trimmed.replace('Dialogue:', '').trimStart();
                const values = rawValues.split(',');

                const textIndex = formatFields.indexOf('Text');
                const startIndex = formatFields.indexOf('Start');
                const endIndex = formatFields.indexOf('End');

                if (textIndex !== -1 && startIndex !== -1) {
                    // Text field may contain commas, so join everything from textIndex onward
                    const text = values.slice(textIndex).join(',').trim();
                    const cleanedText = text
                        .replace(/\{[^}]*\}/g, '')  // Remove ASS style tags like {\b1}
                        .replace(/\\N/g, '\n')       // Convert \N to newline
                        .replace(/\\n/g, '\n')       // Convert \n to newline
                        .replace(/\\h/g, ' ')        // Convert \h to space
                        .trim();

                    if (cleanedText) {
                        subtitles.push({
                            index: subtitles.length + 1,
                            startTime: this.parseASSTime(values[startIndex]?.trim()),
                            endTime: this.parseASSTime(values[endIndex]?.trim()),
                            text: cleanedText
                        });
                    }
                }
            }
        }

        return subtitles;
    }

    /**
     * Parse VTT (WebVTT) format
     */
    static parseVTT(content) {
        const blocks = content.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
        const subtitles = [];

        for (const block of blocks) {
            const lines = block.trim().split('\n');

            // Skip WEBVTT header and NOTE blocks
            if (lines[0].startsWith('WEBVTT')) continue;
            if (lines[0].startsWith('NOTE')) continue;
            if (lines[0].startsWith('STYLE')) continue;

            let timeLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) {
                    timeLineIndex = i;
                    break;
                }
            }

            if (timeLineIndex === -1) continue;

            const timeParts = lines[timeLineIndex].split('-->');
            if (timeParts.length !== 2) continue;

            // VTT may have position settings after timestamp
            const startTime = this.parseVTTTime(timeParts[0].trim());
            const endTime = this.parseVTTTime(timeParts[1].trim().split(/\s/)[0]);
            const text = lines.slice(timeLineIndex + 1).join('\n').trim();

            if (text) {
                subtitles.push({
                    index: subtitles.length + 1,
                    startTime,
                    endTime,
                    text: this.cleanText(text)
                });
            }
        }

        return subtitles;
    }

    /**
     * Parse plain TXT (one line = one subtitle)
     */
    static parseTXT(content) {
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            .split('\n')
            .filter(l => l.trim());

        return lines.map((line, i) => ({
            index: i + 1,
            startTime: 0,
            endTime: 0,
            text: line.trim()
        }));
    }

    /**
     * Parse Image Prompts TXT (format: [MM:SS] prompt text)
     * e.g. [00:11] A beautiful landscape...
     */
    static parseImagePrompts(content) {
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            .split('\n')
            .filter(l => l.trim());
            
        const prompts = [];
        const regex = /\[(?:(\d{1,2}):)?(\d{2}):(\d{2})\]\s*(.*)/;
        
        for (const line of lines) {
            const match = line.match(regex);
            if (match) {
                const hours = parseInt(match[1] || 0);
                const minutes = parseInt(match[2]);
                const seconds = parseInt(match[3]);
                const text = match[4].trim();
                
                prompts.push({
                    timeString: match[0].split(']')[0] + ']', // e.g. [00:11]
                    timestamp: hours * 3600 + minutes * 60 + seconds,
                    prompt: text
                });
            }
        }
        
        // Sort by timestamp just in case
        return prompts.sort((a, b) => a.timestamp - b.timestamp);
    }

    // ============ Time Parsing Helpers ============

    /**
     * Parse SRT timestamp: HH:MM:SS,mmm → seconds
     */
    static parseSRTTime(timeStr) {
        const match = timeStr.match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/);
        if (!match) return 0;
        return parseInt(match[1]) * 3600 +
               parseInt(match[2]) * 60 +
               parseInt(match[3]) +
               parseInt(match[4]) / 1000;
    }

    /**
     * Parse ASS timestamp: H:MM:SS.cc → seconds
     */
    static parseASSTime(timeStr) {
        const match = timeStr?.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
        if (!match) return 0;
        return parseInt(match[1]) * 3600 +
               parseInt(match[2]) * 60 +
               parseInt(match[3]) +
               parseInt(match[4]) / 100;
    }

    /**
     * Parse VTT timestamp: HH:MM:SS.mmm or MM:SS.mmm → seconds
     */
    static parseVTTTime(timeStr) {
        const match = timeStr.match(/(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})/);
        if (!match) return 0;
        return (parseInt(match[1] || 0)) * 3600 +
               parseInt(match[2]) * 60 +
               parseInt(match[3]) +
               parseInt(match[4]) / 1000;
    }

    // ============ Time Formatting Helpers ============

    /**
     * Format seconds → SRT timestamp (HH:MM:SS,mmm)
     */
    static formatSRTTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.round((seconds % 1) * 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    }

    /**
     * Format seconds → VTT timestamp (HH:MM:SS.mmm)
     */
    static formatVTTTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.round((seconds % 1) * 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    /**
     * Clean text by removing HTML/style tags
     */
    static cleanText(text) {
        return text
            .replace(/<[^>]*>/g, '')   // Remove HTML tags
            .replace(/\{[^}]*\}/g, '') // Remove style tags {...}
            .trim();
    }
}
