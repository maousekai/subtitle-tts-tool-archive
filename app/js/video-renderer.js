/**
 * Video Renderer using FFmpeg.wasm
 */
class VideoRenderer {
    constructor() {
        this.ffmpeg = new FFmpegWASM.FFmpeg();
        this.fetchFile = FFmpegUtil.fetchFile;
        this.isLoaded = false;
        
        // Listen to progress
        this.ffmpeg.on('progress', ({ progress, time }) => {
            if (this.onProgress) {
                this.onProgress(progress, time);
            }
        });

        this.ffmpeg.on('log', ({ message }) => {
            console.log('[FFmpeg]', message);
        });
    }

    /**
     * Load FFmpeg core
     */
    async load(onLog) {
        if (this.isLoaded) return;
        
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        try {
            if (onLog) onLog("Đang tải thư viện FFmpeg.wasm (có thể mất vài phút lần đầu)...");
            
            await this.ffmpeg.load({
                coreURL: await this.toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await this.toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            this.isLoaded = true;
            if (onLog) onLog("Đã tải xong FFmpeg!");
        } catch (error) {
            console.error("Lỗi tải FFmpeg:", error);
            if (onLog) onLog("Lỗi tải FFmpeg: " + error.message);
            throw error;
        }
    }

    async toBlobURL(url, mimeType) {
        const resp = await fetch(url);
        const blob = await resp.blob();
        return URL.createObjectURL(new Blob([blob], { type: mimeType }));
    }

    /**
     * Render Video from Audio and Images
     * @param {Blob} audioBlob - The merged MP3 audio
     * @param {Array<{timestamp: number, blob: Blob}>} imageList - List of images with their timestamps (in seconds)
     * @param {number} audioDuration - Total duration of the audio in seconds
     */
    async render(audioBlob, imageList, audioDuration) {
        if (!this.isLoaded) throw new Error("FFmpeg chưa được tải. Hãy gọi load() trước.");
        if (!imageList || imageList.length === 0) throw new Error("Không có ảnh để tạo video.");

        // Write audio to FS
        await this.ffmpeg.writeFile('audio.mp3', await this.fetchFile(audioBlob));

        // Write images and create concat.txt
        let concatText = "";
        
        for (let i = 0; i < imageList.length; i++) {
            const img = imageList[i];
            const fileName = `img_${i}.jpg`;
            
            // Write image to FS
            await this.ffmpeg.writeFile(fileName, await this.fetchFile(img.blob));
            
            // Calculate duration
            const nextTime = (i < imageList.length - 1) ? imageList[i+1].timestamp : audioDuration;
            let duration = nextTime - img.timestamp;
            if (duration <= 0) duration = 1; // Fallback
            
            concatText += `file '${fileName}'\n`;
            concatText += `duration ${duration.toFixed(2)}\n`;
        }
        
        // Concat demuxer requires the last file to be repeated without duration
        const lastFileName = `img_${imageList.length - 1}.jpg`;
        concatText += `file '${lastFileName}'\n`;

        await this.ffmpeg.writeFile('concat.txt', concatText);

        // Run FFmpeg command
        // -f concat: use concat demuxer
        // -i concat.txt: input file list
        // -i audio.mp3: input audio
        // -c:v libx264: video codec
        // -vf fps=30,format=yuv420p: standard mp4 format
        // -c:a aac: audio codec
        // -shortest: stop encoding when the shortest stream ends
        
        await this.ffmpeg.exec([
            '-f', 'concat',
            '-i', 'concat.txt',
            '-i', 'audio.mp3',
            '-c:v', 'libx264',
            '-vf', 'fps=30,format=yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            'output.mp4'
        ]);

        // Read the result
        const data = await this.ffmpeg.readFile('output.mp4');
        const mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });
        
        // Clean up memory
        await this.ffmpeg.deleteFile('audio.mp3');
        await this.ffmpeg.deleteFile('concat.txt');
        for (let i = 0; i < imageList.length; i++) {
            await this.ffmpeg.deleteFile(`img_${i}.jpg`);
        }
        await this.ffmpeg.deleteFile('output.mp4');

        return mp4Blob;
    }
}

window.VideoRenderer = new VideoRenderer();
