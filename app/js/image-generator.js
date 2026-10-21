/**
 * Gemini API / Imagen 3 Handler
 */
class ImageGeneratorApi {
    constructor() {
        this.apiKey = localStorage.getItem('gemini_api_key') || '';
        // Cập nhật lên model mới nhất của Gemini hỗ trợ sinh ảnh
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';
    }

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('gemini_api_key', key);
    }

    getApiKey() {
        return this.apiKey;
    }

    /**
     * Generate an image from prompt
     * @param {string} prompt 
     * @param {string} aspectRatio (e.g., "16:9", "1:1", "9:16")
     * @returns {Promise<Blob>} The generated image as a blob
     */
    async generateImage(prompt, aspectRatio = '16:9') {
        if (!this.apiKey) throw new Error('Chưa cấu hình Gemini API Key');

        // Body mới theo chuẩn generateContent của Gemini 2.5 Flash Image
        const body = {
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: prompt + `\n\n[Aspect Ratio: ${aspectRatio}]` }
                    ]
                }
            ],
            generationConfig: {
                responseModalities: ["IMAGE"]
            }
        };

        try {
            const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || `Lỗi Gemini API: ${response.status}`);
            }

            const data = await response.json();

            if (data.candidates && data.candidates.length > 0) {
                const parts = data.candidates[0].content?.parts || [];
                let base64Data = null;

                for (const part of parts) {
                    if (part.inlineData && part.inlineData.data) {
                        base64Data = part.inlineData.data;
                        break;
                    }
                }

                if (!base64Data) throw new Error('Không tìm thấy dữ liệu ảnh trả về từ API');

                // Convert base64 to Blob
                const binaryString = window.atob(base64Data);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                return new Blob([bytes], { type: 'image/jpeg' });
            } else {
                throw new Error('API không trả về kết quả ảnh nào.');
            }

        } catch (error) {
            console.error('Image Generation error:', error);
            throw error;
        }
    }
}

window.ImageGenerator = new ImageGeneratorApi();
