/**
 * AudioMerger - Merge multiple audio blobs and generate timelines
 * Uses Web Audio API for audio concatenation
 */
class AudioMerger {

    /**
     * Merge multiple audio blobs into a single WAV file
     * @param {Blob[]} audioBlobs - Array of audio blobs to merge
     * @param {number} gapMs - Silence gap between clips in milliseconds
     * @returns {Blob} Merged audio as WAV blob
     */
    static async merge(audioBlobs, gapMs = 300) {
        if (!audioBlobs || audioBlobs.length === 0) {
            throw new Error('Không có audio nào để ghép');
        }

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const buffers = [];

        // Decode all blobs to AudioBuffer
        for (let i = 0; i < audioBlobs.length; i++) {
            try {
                const arrayBuffer = await audioBlobs[i].arrayBuffer();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                buffers.push(audioBuffer);
            } catch (e) {
                console.warn(`Không thể decode audio blob ${i}:`, e);
            }
        }

        if (buffers.length === 0) {
            await audioContext.close();
            throw new Error('Không thể decode bất kỳ audio blob nào');
        }

        // Use the sample rate from the first buffer
        const sampleRate = buffers[0].sampleRate;
        const numberOfChannels = Math.max(...buffers.map(b => b.numberOfChannels));
        const gapSamples = Math.floor(sampleRate * (gapMs / 1000));

        // Calculate total length
        let totalLength = 0;
        for (const buf of buffers) {
            totalLength += buf.length;
        }
        totalLength += gapSamples * (buffers.length - 1); // Gaps between clips

        // Create merged buffer
        const mergedBuffer = audioContext.createBuffer(
            numberOfChannels,
            totalLength,
            sampleRate
        );

        let offset = 0;
        for (let i = 0; i < buffers.length; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const channelData = mergedBuffer.getChannelData(channel);
                const sourceChannel = Math.min(channel, buffers[i].numberOfChannels - 1);
                const sourceData = buffers[i].getChannelData(sourceChannel);
                channelData.set(sourceData, offset);
            }
            offset += buffers[i].length;

            // Add silence gap (already zeroed by default)
            if (i < buffers.length - 1) {
                offset += gapSamples;
            }
        }

        // Convert to WAV
        const wavBlob = this.audioBufferToWav(mergedBuffer);

        await audioContext.close();
        return wavBlob;
    }

    /**
     * Convert AudioBuffer to WAV Blob
     */
    static audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const bitsPerSample = 16;
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numChannels * bytesPerSample;
        const dataLength = buffer.length * blockAlign;
        const bufferLength = 44 + dataLength;

        const arrayBuffer = new ArrayBuffer(bufferLength);
        const view = new DataView(arrayBuffer);

        // RIFF header
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        this.writeString(view, 8, 'WAVE');

        // fmt chunk
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);                    // Chunk size
        view.setUint16(20, 1, true);                      // PCM format
        view.setUint16(22, numChannels, true);            // Number of channels
        view.setUint32(24, sampleRate, true);             // Sample rate
        view.setUint32(28, sampleRate * blockAlign, true); // Byte rate
        view.setUint16(32, blockAlign, true);             // Block align
        view.setUint16(34, bitsPerSample, true);          // Bits per sample

        // data chunk
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        // Write interleaved audio data
        let offset = 44;
        for (let i = 0; i < buffer.length; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
                const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, int16, true);
                offset += 2;
            }
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    /**
     * Write string to DataView
     */
    static writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    /**
     * Get duration of an audio blob in seconds
     */
    static getAudioDuration(blob) {
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
     * Generate timeline (SRT or VTT) from processed items
     * @param {Array} items - Processed batch items with audioDuration
     * @param {string} format - 'srt' or 'vtt'
     * @param {number} gapMs - Gap between clips in milliseconds
     * @returns {string} Timeline content
     */
    static generateTimeline(items, format = 'srt', gapMs = 300) {
        let output = '';
        let currentTime = 0;
        const gapSeconds = gapMs / 1000;
        let counter = 1;

        if (format === 'vtt') {
            output = 'WEBVTT\n\n';
        }

        for (const item of items) {
            if (item.status !== 'done' || !item.audioDuration) continue;

            const startTime = currentTime;
            const endTime = currentTime + item.audioDuration;

            if (format === 'srt') {
                output += `${counter}\n`;
                output += `${SubtitleParser.formatSRTTime(startTime)} --> ${SubtitleParser.formatSRTTime(endTime)}\n`;
                output += `${item.text}\n\n`;
            } else if (format === 'vtt') {
                output += `${SubtitleParser.formatVTTTime(startTime)} --> ${SubtitleParser.formatVTTTime(endTime)}\n`;
                output += `${item.text}\n\n`;
            }

            currentTime = endTime + gapSeconds;
            counter++;
        }

        return output.trim();
    }

    /**
     * Download a Blob as a file
     */
    static downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    /**
     * Download text content as a file
     */
    static downloadText(content, filename, mimeType = 'text/plain') {
        const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
        this.downloadBlob(blob, filename);
    }

    /**
     * Download individual audio files as a zip-like package (sequential downloads)
     */
    static async downloadAll(items, prefix = 'audio') {
        const completedItems = items.filter(i => i.status === 'done' && i.audioBlob);

        for (let i = 0; i < completedItems.length; i++) {
            const item = completedItems[i];
            const filename = `${prefix}_${String(i + 1).padStart(3, '0')}.mp3`;
            this.downloadBlob(item.audioBlob, filename);

            // Small delay between downloads to avoid browser blocking
            if (i < completedItems.length - 1) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }
}
