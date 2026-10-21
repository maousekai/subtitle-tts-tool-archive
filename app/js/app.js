/**
 * App - Main controller for ElevenLabs TTS Tool
 * Connects all modules and manages UI state
 */
class App {
    constructor() {
        // Core modules
        this.elevenLabsApi = new ElevenLabsAPI();
        this.googleApi = window.GoogleTTS;
        this.api = this.elevenLabsApi; // Default
        this.ttsProvider = 'elevenlabs';
        this.cache = new CacheManager();

        // Video Phase State
        this.videoAudioBlob = null;
        this.videoPromptList = [];
        this.resultVideoBlob = null;
        this.processor = null; // Initialized after cache is ready
        this.fallback = new FallbackTTS();

        // Audio player state
        this.audioPlayer = document.getElementById('audioPlayer');
        this.currentPlayingIndex = -1;
        this.isPlaying = false;

        // UI update timer
        this.statsTimer = null;

        // Voices cache
        this.voices = [];

        // Init
        this.init();
    }

    async init() {
        try {
            // Initialize cache
            await this.cache.init();

            // Initialize batch processor
            this.processor = new BatchProcessor(this.api, this.cache);
            this.bindProcessorEvents();

            // Initialize fallback TTS
            if (FallbackTTS.isSupported()) {
                await this.fallback.init();
            }

            // Bind UI events
            this.bindEvents();

            // Load saved settings
            this.loadSettings();

            // Update cache stats
            this.updateCacheStats();

            // Auto-connect if API key exists
            if (this.api.hasApiKey()) {
                this.connectAndLoadVoices();
            } else {
                // Show API key modal on first visit
                this.showApiKeyModal();
            }

        } catch (error) {
            console.error('Init error:', error);
            this.showToast('Lỗi khởi tạo: ' + error.message, 'error');
        }
    }

    // ============ Event Binding ============

    bindEvents() {
        // API Key
        document.getElementById('btnApiKey').addEventListener('click', () => this.showApiKeyModal());
        document.getElementById('btnModalCancel').addEventListener('click', () => this.hideApiKeyModal());
        document.getElementById('btnTestConnection').addEventListener('click', () => this.testConnection());
        document.getElementById('btnSaveApiKey').addEventListener('click', () => this.saveApiKey());
        document.getElementById('creditsBadge').addEventListener('click', () => this.refreshCredits());

        // Close modals on overlay click
        document.getElementById('apiKeyModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideApiKeyModal();
        });
        document.getElementById('textInputModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideTextInputModal();
        });

        // Import
        document.getElementById('btnImportFile').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        document.getElementById('btnImportFolder').addEventListener('click', () => {
            document.getElementById('folderInput').click();
        });
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileImport(e));
        document.getElementById('folderInput').addEventListener('change', (e) => this.handleFileImport(e));

        // Text Input
        document.getElementById('btnAddText').addEventListener('click', () => this.showTextInputModal());
        document.getElementById('btnTextCancel').addEventListener('click', () => this.hideTextInputModal());
        document.getElementById('btnTextAdd').addEventListener('click', () => this.addTextAsSubtitles());
        document.getElementById('textInputArea').addEventListener('input', (e) => {
            document.getElementById('textCharCount').textContent = `${e.target.value.length} ký tự`;
        });

        // Drag & Drop
        const dropZone = document.getElementById('subtitlePanel');
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            this.handleFileDrop(e);
        });

        // Batch controls
        document.getElementById('btnStart').addEventListener('click', () => this.startBatch());
        document.getElementById('btnPause').addEventListener('click', () => this.togglePause());
        document.getElementById('btnStop').addEventListener('click', () => this.stopBatch());
        document.getElementById('btnClearList').addEventListener('click', () => this.clearList());

        // Audio player
        document.getElementById('btnPlayerPlay').addEventListener('click', () => this.togglePlay());
        document.getElementById('playerProgressBar').addEventListener('click', (e) => this.seekAudio(e));
        this.audioPlayer.addEventListener('timeupdate', () => this.updatePlayerProgress());
        this.audioPlayer.addEventListener('ended', () => this.onAudioEnded());
        this.audioPlayer.addEventListener('loadedmetadata', () => this.updatePlayerProgress());

        // Output actions
        document.getElementById('btnDownloadAll').addEventListener('click', () => this.downloadAll());
        document.getElementById('btnJoinAudio').addEventListener('click', () => this.joinAudio());
        document.getElementById('btnExportSRT').addEventListener('click', () => this.exportTimeline('srt'));
        document.getElementById('btnExportVTT').addEventListener('click', () => this.exportTimeline('vtt'));
        document.getElementById('btnClearCache').addEventListener('click', () => this.clearCache());

        // Voice settings
        document.getElementById('voiceSelect').addEventListener('change', (e) => this.onVoiceChange(e));

        // Voice search filter
        const voiceSearch = document.getElementById('voiceSearch');
        if (voiceSearch) {
            voiceSearch.addEventListener('input', (e) => this.filterVoices(e.target.value));
        }

        // Custom voice ID
        const btnUseCustomVoice = document.getElementById('btnUseCustomVoice');
        if (btnUseCustomVoice) {
            btnUseCustomVoice.addEventListener('click', () => this.useCustomVoice());
        }

        // Test Voice
        const btnTestVoice = document.getElementById('btnTestVoice');
        const btnTestVoice2 = document.getElementById('btnTestVoice2');
        if (btnTestVoice) btnTestVoice.addEventListener('click', () => this.testVoice());
        if (btnTestVoice2) btnTestVoice2.addEventListener('click', () => this.testVoice());

        // Sliders
        this.bindSlider('speedSlider', 'speedValue', (v) => `${parseFloat(v).toFixed(2)}x`);
        this.bindSlider('stabilitySlider', 'stabilityValue', (v) => `${Math.round(v * 100)}%`);
        this.bindSlider('similaritySlider', 'similarityValue', (v) => `${Math.round(v * 100)}%`);
        this.bindSlider('styleSlider', 'styleValue', (v) => `${Math.round(v * 100)}%`);

        // Language override toggle
        document.getElementById('langOverrideToggle').addEventListener('change', (e) => {
            document.getElementById('languageSelect').style.display = e.target.checked ? 'block' : 'none';
        });

        // Reset settings
        document.getElementById('btnResetSettings').addEventListener('click', () => this.resetSettings());

        // Save settings on any change
        const settingsElements = ['modelSelect', 'speedSlider', 'stabilitySlider', 'similaritySlider',
            'styleSlider', 'speakerBoostToggle', 'langOverrideToggle', 'languageSelect', 'outputFormatSelect'];
        settingsElements.forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.saveSettings());
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideApiKeyModal();
                this.hideTextInputModal();
                this.hideGoogleApiKeyModal();
            }
        });

        // Tab Switching
        document.getElementById('btnTabAudio').addEventListener('click', () => this.showTabAudio());
        document.getElementById('btnTabVideo').addEventListener('click', () => this.showTabVideo());

        // TTS Provider
        const providerSelect = document.getElementById('ttsProviderSelect');
        if (providerSelect) {
            providerSelect.addEventListener('change', (e) => this.switchTtsProvider(e.target.value));
        }

        // Google API Key Modal
        const btnSaveGoogle = document.getElementById('btnSaveGoogleApiKey');
        if (btnSaveGoogle) btnSaveGoogle.addEventListener('click', () => this.saveGoogleApiKey());
        const btnCancelGoogle = document.getElementById('btnGoogleModalCancel');
        if (btnCancelGoogle) btnCancelGoogle.addEventListener('click', () => this.hideGoogleApiKeyModal());
        const googleModal = document.getElementById('googleApiKeyModal');
        if (googleModal) googleModal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideGoogleApiKeyModal();
        });

        // Video Phase
        const btnImportAssets = document.getElementById('btnImportVideoAssets');
        if (btnImportAssets) btnImportAssets.addEventListener('click', () => {
            document.getElementById('videoAssetsInput').click();
        });
        const inputAssets = document.getElementById('videoAssetsInput');
        if (inputAssets) inputAssets.addEventListener('change', (e) => this.handleVideoAssetsImport(e));
        const btnStartVideo = document.getElementById('btnStartVideo');
        if (btnStartVideo) btnStartVideo.addEventListener('click', () => this.startVideoRender());
        const btnClearVideo = document.getElementById('btnClearVideoList');
        if (btnClearVideo) btnClearVideo.addEventListener('click', () => this.clearVideoList());
        const btnDownloadVideo = document.getElementById('btnDownloadVideo');
        if (btnDownloadVideo) btnDownloadVideo.addEventListener('click', () => this.downloadVideo());

        const imageProviderSelect = document.getElementById('imageProviderSelect');
        const geminiKeyGroup = document.getElementById('geminiKeyGroup');
        const localFolderGroup = document.getElementById('localFolderGroup');
        if (imageProviderSelect) {
            imageProviderSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                if (geminiKeyGroup) geminiKeyGroup.style.display = val === 'gemini' ? 'block' : 'none';
                if (localFolderGroup) localFolderGroup.style.display = val === 'local' ? 'block' : 'none';
            });
        }

        const btnImportImageFolder = document.getElementById('btnImportImageFolder');
        const localImageFolderInput = document.getElementById('localImageFolderInput');
        if (btnImportImageFolder && localImageFolderInput) {
            btnImportImageFolder.addEventListener('click', () => localImageFolderInput.click());
            localImageFolderInput.addEventListener('change', (e) => this.handleLocalImageFolderImport(e));
        }

        const singleImageOverrideInput = document.getElementById('singleImageOverrideInput');
        if (singleImageOverrideInput) {
            singleImageOverrideInput.addEventListener('change', (e) => this.handleSingleImageOverride(e));
        }

        const promptList = document.getElementById('promptList');
        if (promptList) {
            promptList.addEventListener('click', (e) => {
                if (e.target.classList.contains('btn-override-img')) {
                    this.currentOverrideIdx = e.target.getAttribute('data-idx');
                    if (singleImageOverrideInput) singleImageOverrideInput.click();
                }
            });
        }
    }

    bindSlider(sliderId, valueId, formatter) {
        const slider = document.getElementById(sliderId);
        const valueEl = document.getElementById(valueId);
        slider.addEventListener('input', () => {
            valueEl.textContent = formatter(slider.value);
        });
        // Also on change for saving
        slider.addEventListener('change', () => {
            valueEl.textContent = formatter(slider.value);
            this.saveSettings();
        });
    }

    bindProcessorEvents() {
        this.processor.addEventListener('itemsLoaded', (e) => {
            this.renderSubtitleList();
            this.updateBatchStats(e.detail.stats);
            this.updateBatchButtons();
        });

        this.processor.addEventListener('itemProgress', (e) => {
            this.updateSubtitleItem(e.detail.index, e.detail.item);
            this.updateBatchStats(e.detail.stats);
        });

        this.processor.addEventListener('batchStart', (e) => {
            this.updateBatchStats(e.detail);
            this.updateBatchButtons();
            this.startStatsTimer();
        });

        this.processor.addEventListener('batchComplete', (e) => {
            this.updateBatchStats(e.detail);
            this.updateBatchButtons();
            this.updateOutputButtons();
            this.stopStatsTimer();
            this.updateCacheStats();
            this.refreshCredits();

            const stats = e.detail;
            if (stats.errors > 0) {
                this.showToast(`Hoàn thành: ${stats.done} thành công, ${stats.errors} lỗi`, 'warning');
            } else {
                this.showToast(`✅ Hoàn thành ${stats.done} subtitles! Tiết kiệm ${TextOptimizer.formatNumber(stats.charsSaved)} ký tự`, 'success');
            }
        });

        this.processor.addEventListener('batchPaused', (e) => {
            this.updateBatchStats(e.detail);
            this.updateBatchButtons();
            this.showToast('⏸ Đã tạm dừng', 'info');
        });

        this.processor.addEventListener('batchResumed', (e) => {
            this.updateBatchStats(e.detail);
            this.updateBatchButtons();
            this.showToast('▶ Tiếp tục...', 'info');
        });

        this.processor.addEventListener('batchCancelled', (e) => {
            this.updateBatchStats(e.detail);
            this.updateBatchButtons();
            this.stopStatsTimer();
            this.showToast('⏹ Đã dừng', 'warning');
        });

        this.processor.addEventListener('batchReset', (e) => {
            this.renderSubtitleList();
            this.updateBatchStats(e.detail);
            this.updateBatchButtons();
            this.updateOutputButtons();
        });
    }

    // ============ API Key Management ============

    showApiKeyModal() {
        if (this.ttsProvider === 'google') {
            const modal = document.getElementById('googleApiKeyModal');
            const input = document.getElementById('googleApiKeyInput');
            const status = document.getElementById('googleConnectionStatus');
            if (input) input.value = this.googleApi.getApiKey();
            if (status) {
                status.style.display = 'none';
                status.className = 'connection-status';
            }
            if (modal) modal.classList.add('active');
            setTimeout(() => { if (input) input.focus(); }, 300);
        } else {
            const modal = document.getElementById('apiKeyModal');
            const input = document.getElementById('apiKeyInput');
            const status = document.getElementById('connectionStatus');

            input.value = this.api.getApiKey();
            status.style.display = 'none';
            status.className = 'connection-status';

            modal.classList.add('active');
            setTimeout(() => input.focus(), 300);
        }
    }

    hideApiKeyModal() {
        document.getElementById('apiKeyModal').classList.remove('active');
    }

    async testConnection() {
        const key = document.getElementById('apiKeyInput').value.trim();
        const status = document.getElementById('connectionStatus');
        const btn = document.getElementById('btnTestConnection');

        if (!key) {
            status.textContent = '❌ Vui lòng nhập API key';
            status.className = 'connection-status error';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Đang kiểm tra...';

        // Temporarily set key for testing
        const oldKey = this.api.getApiKey();
        this.api.setApiKey(key);

        const result = await this.api.verifyConnection();

        if (result.success) {
            const sub = result.subscription;
            const remaining = sub.characterLimit - sub.characterCount;
            status.innerHTML = `✅ Kết nối thành công!<br>
                Plan: ${sub.tier} | Credits: ${TextOptimizer.formatNumber(remaining)} / ${TextOptimizer.formatNumber(sub.characterLimit)}`;
            status.className = 'connection-status success';
        } else {
            // Fallback: Test fetching voices if subscription fails (due to restricted API key)
            try {
                const voices = await this.api.getVoices();
                if (voices && voices.length > 0) {
                    status.innerHTML = `✅ Kết nối thành công (API Key bị giới hạn quyền xem Credits)!<br>
                        Đã tải được ${voices.length} voices.`;
                    status.className = 'connection-status success';
                } else {
                    throw new Error(result.error);
                }
            } catch (e) {
                status.textContent = `❌ ${result.error}`;
                status.className = 'connection-status error';
                this.api.setApiKey(oldKey); // Restore old key on failure
            }
        }

        btn.disabled = false;
        btn.innerHTML = '🔍 Test';
    }

    async saveApiKey() {
        const key = document.getElementById('apiKeyInput').value.trim();

        if (!key) {
            this.showToast('Vui lòng nhập API key', 'warning');
            return;
        }

        this.api.setApiKey(key);
        this.hideApiKeyModal();
        this.showToast('✅ API key đã lưu', 'success');

        await this.connectAndLoadVoices();
    }

    async connectAndLoadVoices() {
        try {
            // Verify connection
            const result = await this.api.verifyConnection();
            if (result.success) {
                this.updateCreditsDisplay(result.subscription);
            } else {
                // If restricted key, show generic connected state
                const badge = document.getElementById('creditsBadge');
                badge.classList.remove('warning', 'danger');
                document.getElementById('creditsText').textContent = 'Đã kết nối (ẩn Credits)';
                document.getElementById('footerCredits').textContent = 'Restricted API Key';
            }

            // Load voices
            const voices = await this.api.getVoices();
            this.voices = voices;
            this.populateVoiceSelect(voices);

        } catch (error) {
            console.error('Failed to load voices:', error);
            this.showToast('Không thể tải danh sách voices: ' + error.message, 'error');
        }
    }

    async refreshCredits() {
        if (!this.api.hasApiKey()) return;

        try {
            const result = await this.api.verifyConnection();
            if (result.success) {
                this.updateCreditsDisplay(result.subscription);
            }
        } catch (e) {
            console.warn('Failed to refresh credits:', e);
        }
    }

    updateCreditsDisplay(subscription) {
        const badge = document.getElementById('creditsBadge');
        const creditsText = document.getElementById('creditsText');
        const footerCredits = document.getElementById('footerCredits');
        const footerResetDate = document.getElementById('footerResetDate');

        const remaining = subscription.characterLimit - subscription.characterCount;
        const percentage = (remaining / subscription.characterLimit) * 100;

        creditsText.textContent = `${TextOptimizer.formatNumber(remaining)} credits`;

        // Color based on remaining percentage
        badge.classList.remove('warning', 'danger');
        if (percentage < 10) {
            badge.classList.add('danger');
        } else if (percentage < 30) {
            badge.classList.add('warning');
        }

        // Footer stats
        footerCredits.textContent = `${TextOptimizer.formatNumber(remaining)} / ${TextOptimizer.formatNumber(subscription.characterLimit)}`;

        if (subscription.nextResetDate) {
            footerResetDate.textContent = subscription.nextResetDate.toLocaleDateString('vi-VN');
        }
    }

    // ============ Voice Management ============

    populateVoiceSelect(voices) {
        const select = document.getElementById('voiceSelect');
        const currentValue = select.value;

        select.innerHTML = '';

        // Group voices by category
        const premade = voices.filter(v => v.category === 'premade' || !v.category);
        const cloned = voices.filter(v => v.category === 'cloned');
        const custom = voices.filter(v => v.category !== 'premade' && v.category !== 'cloned' && v.category);

        const addOptions = (list, groupLabel) => {
            if (list.length === 0) return;
            const optgroup = document.createElement('optgroup');
            optgroup.label = groupLabel;
            list.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.voice_id;
                opt.textContent = v.name;
                opt.dataset.labels = (v.labels ? Object.values(v.labels).join(', ') : '');
                optgroup.appendChild(opt);
            });
            select.appendChild(optgroup);
        };

        if (cloned.length > 0) addOptions(cloned, '🎤 My Voices');
        if (custom.length > 0) addOptions(custom, '✨ Custom');
        addOptions(premade, '🌍 Premade Voices');

        // Restore selection or default
        const defaultVoice = 'sB7vwSCyX0tQmU24cW2C';
        if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
            select.value = currentValue;
        } else if (select.querySelector(`option[value="${defaultVoice}"]`)) {
            select.value = defaultVoice;
        }

        // Update preview
        this.onVoiceChange({ target: select });
    }

    onVoiceChange(e) {
        const voiceId = e.target.value;
        const voice = this.voices.find(v => v.voice_id === voiceId);

        const nameEl = document.getElementById('voiceName');
        const descEl = document.getElementById('voiceDesc');

        if (voice) {
            nameEl.textContent = voice.name;
            const labels = voice.labels ? Object.values(voice.labels).join(', ') : '';
            descEl.textContent = labels || voice.description || voiceId;
        } else {
            nameEl.textContent = voiceId;
            descEl.textContent = 'Voice ID';
        }

        this.saveSettings();
    }

    filterVoices(query) {
        const select = document.getElementById('voiceSelect');
        const q = query.toLowerCase();

        // Loop through option groups and options
        Array.from(select.children).forEach(group => {
            if (group.tagName === 'OPTGROUP') {
                let hasVisibleChild = false;
                Array.from(group.children).forEach(option => {
                    const text = option.textContent.toLowerCase();
                    const labels = (option.dataset.labels || '').toLowerCase();
                    const isVisible = text.includes(q) || labels.includes(q);
                    option.style.display = isVisible ? '' : 'none';
                    if (isVisible) hasVisibleChild = true;
                });
                group.style.display = hasVisibleChild ? '' : 'none';
            } else if (group.tagName === 'OPTION') {
                const text = group.textContent.toLowerCase();
                group.style.display = text.includes(q) ? '' : 'none';
            }
        });
    }

    useCustomVoice() {
        const input = document.getElementById('customVoiceId');
        const voiceId = input.value.trim();

        if (!voiceId) {
            this.showToast('Vui lòng nhập Voice ID', 'warning');
            return;
        }

        const select = document.getElementById('voiceSelect');

        // Check if option exists, if not create it
        let option = select.querySelector(`option[value="${voiceId}"]`);
        if (!option) {
            option = document.createElement('option');
            option.value = voiceId;
            option.textContent = `Custom: ${voiceId}`;
            // Add to top of select (before first optgroup)
            if (select.firstChild) {
                select.insertBefore(option, select.firstChild);
            } else {
                select.appendChild(option);
            }
        }

        select.value = voiceId;
        this.onVoiceChange({ target: select });
        this.showToast('Đã chọn custom Voice ID', 'success');
    }

    async testVoice() {
        if (!this.api.hasApiKey()) {
            this.showApiKeyModal();
            return;
        }

        const voiceId = document.getElementById('voiceSelect').value;
        let text = document.getElementById('testVoiceText').value.trim() || 'Xin chào, đây là giọng đọc thử nghiệm.';

        // Cắt bớt text nếu quá dài để tiết kiệm token khi test
        if (text.length > 100) {
            text = text.substring(0, 100) + '...';
        }

        const statusEl = document.getElementById('testVoiceStatus');

        const btn1 = document.getElementById('btnTestVoice');
        const btn2 = document.getElementById('btnTestVoice2');

        const setGenerating = (isGen) => {
            if (btn1) {
                btn1.disabled = isGen;
                btn1.innerHTML = isGen ? '<span class="spinner"></span>' : '🔊 Test';
            }
            if (btn2) {
                btn2.disabled = isGen;
                btn2.innerHTML = isGen ? '<span class="spinner"></span>' : '🔊 Nghe';
            }
            statusEl.textContent = isGen ? 'Đang tạo audio test...' : '';
        };

        setGenerating(true);

        try {
            const settings = this.getVoiceSettings();
            const audioBlob = await this.api.textToSpeech(text, voiceId, settings);

            // Play it immediately
            const url = URL.createObjectURL(audioBlob);
            this.audioPlayer.src = url;
            this.audioPlayer.play();

            statusEl.textContent = '✅ Đang phát...';
            setTimeout(() => { statusEl.textContent = ''; }, 3000);

            this.refreshCredits(); // Update credits after test
        } catch (error) {
            console.error('Test voice error:', error);
            statusEl.textContent = `❌ Lỗi: ${error.message}`;
            this.showToast(`Lỗi tạo test: ${error.message}`, 'error');
        } finally {
            setGenerating(false);
        }
    }

    // ============ File Import ============

    async handleFileImport(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        await this.processFiles(files);

        // Reset input so same file can be imported again
        e.target.value = '';
    }

    async handleFileDrop(e) {
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        await this.processFiles(files);
    }

    async processFiles(files) {
        const supportedExtensions = ['srt', 'txt', 'ass', 'ssa', 'vtt'];
        let allSubtitles = [];

        for (const file of files) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (!supportedExtensions.includes(ext)) {
                this.showToast(`Bỏ qua file không hỗ trợ: ${file.name}`, 'warning');
                continue;
            }

            try {
                const content = await this.readFile(file);
                const subtitles = SubtitleParser.parse(content, ext);
                allSubtitles = allSubtitles.concat(subtitles);
                this.showToast(`📄 Đã import: ${file.name} (${subtitles.length} dòng)`, 'success');
            } catch (error) {
                this.showToast(`❌ Lỗi đọc file ${file.name}: ${error.message}`, 'error');
            }
        }

        if (allSubtitles.length > 0) {
            // Re-index
            allSubtitles = allSubtitles.map((sub, i) => ({ ...sub, index: i + 1 }));
            this.processor.setItems(allSubtitles);
        }
    }

    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file, 'UTF-8');
        });
    }

    // ============ Text Input ============

    showTextInputModal() {
        const modal = document.getElementById('textInputModal');
        const textarea = document.getElementById('textInputArea');
        textarea.value = '';
        document.getElementById('textCharCount').textContent = '0 ký tự';
        modal.classList.add('active');
        setTimeout(() => textarea.focus(), 300);
    }

    hideTextInputModal() {
        document.getElementById('textInputModal').classList.remove('active');
    }

    addTextAsSubtitles() {
        const text = document.getElementById('textInputArea').value.trim();
        if (!text) {
            this.showToast('Vui lòng nhập văn bản', 'warning');
            return;
        }

        const subtitles = SubtitleParser.parseTXT(text);
        if (subtitles.length > 0) {
            this.processor.setItems(subtitles);
            this.hideTextInputModal();
            this.showToast(`✏️ Đã thêm ${subtitles.length} dòng`, 'success');
        }
    }

    // ============ Subtitle List Rendering ============

    renderSubtitleList() {
        const container = document.getElementById('subtitleList');
        const emptyState = document.getElementById('emptyState');
        const items = this.processor.getItems();

        if (items.length === 0) {
            container.innerHTML = '';
            container.appendChild(emptyState);
            emptyState.style.display = 'flex';
            document.getElementById('subtitleCount').textContent = '0';
            return;
        }

        emptyState.style.display = 'none';
        document.getElementById('subtitleCount').textContent = items.length;

        const fragment = document.createDocumentFragment();

        items.forEach((item, index) => {
            const el = this.createSubtitleElement(item, index);
            fragment.appendChild(el);
        });

        container.innerHTML = '';
        container.appendChild(fragment);
    }

    createSubtitleElement(item, index) {
        const el = document.createElement('div');
        el.className = 'subtitle-item';
        el.id = `sub-${index}`;
        el.dataset.index = index;

        const statusClass = item.fromCache ? 'cached' : item.status;
        const statusText = this.getStatusText(item);

        el.innerHTML = `
            <span class="sub-index">#${item.index}</span>
            <span class="sub-text" title="${this.escapeHtml(item.text)}">${this.escapeHtml(item.text)}</span>
            <span class="sub-status ${statusClass}">${statusText}</span>
            <span class="sub-play">
                <button title="Phát" data-index="${index}">▶</button>
            </span>
        `;

        // Play button click
        el.querySelector('.sub-play button').addEventListener('click', (e) => {
            e.stopPropagation();
            this.playItem(index);
        });

        // Click to select
        el.addEventListener('click', () => {
            document.querySelectorAll('.subtitle-item.active').forEach(el => el.classList.remove('active'));
            el.classList.add('active');
        });

        return el;
    }

    updateSubtitleItem(index, item) {
        const el = document.getElementById(`sub-${index}`);
        if (!el) return;

        const statusEl = el.querySelector('.sub-status');
        const statusClass = item.fromCache ? 'cached' : item.status;
        const statusText = this.getStatusText(item);

        statusEl.className = `sub-status ${statusClass}`;
        statusEl.textContent = statusText;

        // Auto-scroll to current item
        if (item.status === 'processing') {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    getStatusText(item) {
        if (item.fromCache && item.status === 'done') return '💾 Cache';
        switch (item.status) {
            case 'pending': return '⏳ Pending';
            case 'processing': return '🔄 Processing';
            case 'done': return '✅ Done';
            case 'error': return '❌ Error';
            case 'skipped': return '⏭ Skipped';
            default: return item.status;
        }
    }

    // ============ Batch Processing ============

    getVoiceSettings() {
        return {
            model: document.getElementById('modelSelect').value,
            speed: parseFloat(document.getElementById('speedSlider').value),
            stability: parseFloat(document.getElementById('stabilitySlider').value),
            similarity: parseFloat(document.getElementById('similaritySlider').value),
            style: parseFloat(document.getElementById('styleSlider').value),
            speakerBoost: document.getElementById('speakerBoostToggle').checked,
            languageCode: document.getElementById('langOverrideToggle').checked
                ? document.getElementById('languageSelect').value
                : null,
            outputFormat: document.getElementById('outputFormatSelect').value
        };
    }

    startBatch() {
        const voiceId = document.getElementById('voiceSelect').value;
        if (!voiceId) {
            this.showToast('Vui lòng chọn voice', 'warning');
            return;
        }

        if (!this.api.hasApiKey()) {
            this.showToast('Vui lòng cấu hình API key trước', 'warning');
            this.showApiKeyModal();
            return;
        }

        const settings = this.getVoiceSettings();
        this.processor.start(voiceId, settings);
    }

    togglePause() {
        if (this.processor.isPaused) {
            this.processor.resume();
            document.getElementById('btnPause').innerHTML = '⏸ Pause';
        } else {
            this.processor.pause();
            document.getElementById('btnPause').innerHTML = '▶ Resume';
        }
    }

    stopBatch() {
        this.processor.cancel();
        document.getElementById('btnPause').innerHTML = '⏸ Pause';
    }

    clearList() {
        if (this.processor.isRunning) {
            this.showToast('Vui lòng dừng batch trước khi xóa', 'warning');
            return;
        }
        this.processor.reset();
        this.processor.setItems([]);
        this.renderSubtitleList();
        this.updateOutputButtons();
    }

    updateBatchStats(stats) {
        document.getElementById('statDone').textContent = stats.done;
        document.getElementById('statProcessing').textContent = stats.processing;
        document.getElementById('statTotal').textContent = stats.total;
        document.getElementById('statElapsed').textContent = stats.elapsedFormatted || '0:00';
        document.getElementById('batchProgressFill').style.width = `${stats.progress}%`;
        document.getElementById('footerCharsSaved').textContent =
            `${TextOptimizer.formatNumber(stats.charsSaved)} chars`;
    }

    updateBatchButtons() {
        const items = this.processor.getItems();
        const hasItems = items.length > 0;
        const isRunning = this.processor.isRunning;
        const isPaused = this.processor.isPaused;
        const hasPending = items.some(i => i.status === 'pending');

        document.getElementById('btnStart').disabled = !hasItems || isRunning || !hasPending;
        document.getElementById('btnPause').disabled = !isRunning;
        document.getElementById('btnStop').disabled = !isRunning;
    }

    updateOutputButtons() {
        const items = this.processor.getItems();
        const hasCompleted = items.some(i => i.status === 'done' && i.audioBlob);

        document.getElementById('btnDownloadAll').disabled = !hasCompleted;
        document.getElementById('btnJoinAudio').disabled = !hasCompleted;
        document.getElementById('btnExportSRT').disabled = !hasCompleted;
        document.getElementById('btnExportVTT').disabled = !hasCompleted;
    }

    startStatsTimer() {
        this.stopStatsTimer();
        this.statsTimer = setInterval(() => {
            if (this.processor.isRunning) {
                const stats = this.processor.getStats();
                document.getElementById('statElapsed').textContent = stats.elapsedFormatted;
            }
        }, 1000);
    }

    stopStatsTimer() {
        if (this.statsTimer) {
            clearInterval(this.statsTimer);
            this.statsTimer = null;
        }
    }

    // ============ Audio Player ============

    playItem(index) {
        const item = this.processor.getItem(index);
        if (!item || !item.audioBlob) {
            this.showToast('Audio chưa được tạo cho subtitle này', 'info');
            return;
        }

        // Highlight active
        document.querySelectorAll('.subtitle-item.active').forEach(el => el.classList.remove('active'));
        const el = document.getElementById(`sub-${index}`);
        if (el) el.classList.add('active');

        // Play
        this.currentPlayingIndex = index;
        const url = URL.createObjectURL(item.audioBlob);

        this.audioPlayer.src = url;
        this.audioPlayer.play();
        this.isPlaying = true;

        document.getElementById('btnPlayerPlay').textContent = '⏸';
    }

    togglePlay() {
        if (!this.audioPlayer.src) {
            // Play first completed item
            const items = this.processor.getItems();
            const firstDone = items.findIndex(i => i.status === 'done' && i.audioBlob);
            if (firstDone >= 0) {
                this.playItem(firstDone);
            }
            return;
        }

        if (this.isPlaying) {
            this.audioPlayer.pause();
            this.isPlaying = false;
            document.getElementById('btnPlayerPlay').textContent = '▶';
        } else {
            this.audioPlayer.play();
            this.isPlaying = true;
            document.getElementById('btnPlayerPlay').textContent = '⏸';
        }
    }

    seekAudio(e) {
        if (!this.audioPlayer.duration) return;
        const bar = document.getElementById('playerProgressBar');
        const rect = bar.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        this.audioPlayer.currentTime = pos * this.audioPlayer.duration;
    }

    updatePlayerProgress() {
        const current = this.audioPlayer.currentTime || 0;
        const duration = this.audioPlayer.duration || 0;

        const progress = duration > 0 ? (current / duration) * 100 : 0;
        document.getElementById('playerProgressFill').style.width = `${progress}%`;
        document.getElementById('playerTime').textContent =
            `${this.formatTime(current)} / ${this.formatTime(duration)}`;
    }

    onAudioEnded() {
        this.isPlaying = false;
        document.getElementById('btnPlayerPlay').textContent = '▶';

        // Auto-play next
        const items = this.processor.getItems();
        let nextIndex = this.currentPlayingIndex + 1;
        while (nextIndex < items.length) {
            if (items[nextIndex].status === 'done' && items[nextIndex].audioBlob) {
                this.playItem(nextIndex);
                return;
            }
            nextIndex++;
        }
    }

    formatTime(seconds) {
        if (isNaN(seconds) || !isFinite(seconds)) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // ============ Output Actions ============

    async downloadAll() {
        const items = this.processor.getItems();
        this.showToast('📥 Bắt đầu tải xuống...', 'info');
        await AudioMerger.downloadAll(items);
        this.showToast('✅ Tải xuống hoàn tất', 'success');
    }

    async joinAudio() {
        const items = this.processor.getItems();
        const completedBlobs = items
            .filter(i => i.status === 'done' && i.audioBlob)
            .map(i => i.audioBlob);

        if (completedBlobs.length === 0) {
            this.showToast('Không có audio để ghép', 'warning');
            return;
        }

        this.showToast('🔗 Đang ghép audio...', 'info');

        try {
            const mergedBlob = await AudioMerger.merge(completedBlobs, 300);
            AudioMerger.downloadBlob(mergedBlob, `joined_audio_${Date.now()}.wav`);
            this.showToast('✅ Đã ghép và tải xuống audio', 'success');
        } catch (error) {
            this.showToast('❌ Lỗi ghép audio: ' + error.message, 'error');
        }
    }

    exportTimeline(format) {
        const items = this.processor.getItems();
        const timeline = AudioMerger.generateTimeline(items, format, 300);

        if (!timeline) {
            this.showToast('Không có dữ liệu timeline', 'warning');
            return;
        }

        const ext = format === 'vtt' ? 'vtt' : 'srt';
        AudioMerger.downloadText(timeline, `timeline_${Date.now()}.${ext}`);
        this.showToast(`📄 Đã xuất timeline .${ext}`, 'success');
    }

    async clearCache() {
        if (!confirm('Xóa toàn bộ cache audio? Hành động này không thể hoàn tác.')) return;

        await this.cache.clearAll();
        this.updateCacheStats();
        this.showToast('🗑️ Đã xóa cache', 'success');
    }

    async updateCacheStats() {
        try {
            const stats = await this.cache.getStats();
            document.getElementById('footerCacheCount').textContent = `${stats.count} items`;
            document.getElementById('footerCacheSize').textContent = `${stats.totalSizeMB} MB`;
        } catch (e) {
            console.warn('Failed to update cache stats:', e);
        }
    }

    // ============ Settings Persistence ============

    saveSettings() {
        const settings = {
            ttsProvider: this.ttsProvider || 'elevenlabs',
            voiceId: document.getElementById('voiceSelect').value,
            model: document.getElementById('modelSelect').value,
            speed: document.getElementById('speedSlider').value,
            stability: document.getElementById('stabilitySlider').value,
            similarity: document.getElementById('similaritySlider').value,
            style: document.getElementById('styleSlider').value,
            speakerBoost: document.getElementById('speakerBoostToggle').checked,
            langOverride: document.getElementById('langOverrideToggle').checked,
            language: document.getElementById('languageSelect').value,
            outputFormat: document.getElementById('outputFormatSelect').value
        };
        localStorage.setItem('tts_settings', JSON.stringify(settings));
    }

    loadSettings() {
        const saved = localStorage.getItem('tts_settings');
        if (!saved) return;

        try {
            const settings = JSON.parse(saved);

            if (settings.ttsProvider) {
                const providerEl = document.getElementById('ttsProviderSelect');
                if (providerEl) {
                    providerEl.value = settings.ttsProvider;
                    this.switchTtsProvider(settings.ttsProvider);
                }
            }
            if (settings.voiceId) document.getElementById('voiceSelect').value = settings.voiceId;
            if (settings.model) document.getElementById('modelSelect').value = settings.model;

            if (settings.speed !== undefined) {
                document.getElementById('speedSlider').value = settings.speed;
                document.getElementById('speedValue').textContent = `${parseFloat(settings.speed).toFixed(2)}x`;
            }
            if (settings.stability !== undefined) {
                document.getElementById('stabilitySlider').value = settings.stability;
                document.getElementById('stabilityValue').textContent = `${Math.round(settings.stability * 100)}%`;
            }
            if (settings.similarity !== undefined) {
                document.getElementById('similaritySlider').value = settings.similarity;
                document.getElementById('similarityValue').textContent = `${Math.round(settings.similarity * 100)}%`;
            }
            if (settings.style !== undefined) {
                document.getElementById('styleSlider').value = settings.style;
                document.getElementById('styleValue').textContent = `${Math.round(settings.style * 100)}%`;
            }

            if (settings.speakerBoost !== undefined) {
                document.getElementById('speakerBoostToggle').checked = settings.speakerBoost;
            }
            if (settings.langOverride !== undefined) {
                document.getElementById('langOverrideToggle').checked = settings.langOverride;
                document.getElementById('languageSelect').style.display = settings.langOverride ? 'block' : 'none';
            }
            if (settings.language) document.getElementById('languageSelect').value = settings.language;
            if (settings.outputFormat) document.getElementById('outputFormatSelect').value = settings.outputFormat;

        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
    }

    resetSettings() {
        document.getElementById('modelSelect').value = 'eleven_flash_v2_5';
        document.getElementById('speedSlider').value = 1.0;
        document.getElementById('speedValue').textContent = '1.00x';
        document.getElementById('stabilitySlider').value = 0.5;
        document.getElementById('stabilityValue').textContent = '50%';
        document.getElementById('similaritySlider').value = 0.75;
        document.getElementById('similarityValue').textContent = '75%';
        document.getElementById('styleSlider').value = 0;
        document.getElementById('styleValue').textContent = '0%';
        document.getElementById('speakerBoostToggle').checked = true;
        document.getElementById('langOverrideToggle').checked = false;
        document.getElementById('languageSelect').style.display = 'none';
        document.getElementById('languageSelect').value = '';
        document.getElementById('outputFormatSelect').value = 'mp3_44100_128';

        this.saveSettings();
        this.showToast('🔄 Đã reset settings', 'info');
    }

    // ============ Toast Notifications ============

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 4000);
    }

    // ============ Tabs & Video Phase ============

    showTabAudio() {
        document.getElementById('viewAudio').style.display = 'contents';
        document.getElementById('viewVideo').style.display = 'none';
        document.getElementById('btnTabAudio').classList.add('btn-primary');
        document.getElementById('btnTabAudio').style.background = '';
        document.getElementById('btnTabAudio').style.boxShadow = '';
        document.getElementById('btnTabVideo').classList.remove('btn-primary');
        document.getElementById('btnTabVideo').style.background = 'var(--bg-glass)';
        document.getElementById('btnTabVideo').style.boxShadow = 'none';
    }

    showTabVideo() {
        document.getElementById('viewAudio').style.display = 'none';
        document.getElementById('viewVideo').style.display = 'contents';
        document.getElementById('btnTabVideo').classList.add('btn-primary');
        document.getElementById('btnTabVideo').style.background = '';
        document.getElementById('btnTabVideo').style.boxShadow = '';
        document.getElementById('btnTabAudio').classList.remove('btn-primary');
        document.getElementById('btnTabAudio').style.background = 'var(--bg-glass)';
        document.getElementById('btnTabAudio').style.boxShadow = 'none';
    }

    switchTtsProvider(provider) {
        this.ttsProvider = provider;
        if (provider === 'google') {
            this.api = this.googleApi;
            this.processor.api = this.api;
            this.voices = [
                { voice_id: 'en-US-Journey-D', name: 'English Journey D (Nam)' },
                { voice_id: 'en-US-Journey-F', name: 'English Journey F (Nữ)' },
                { voice_id: 'vi-VN-Neural2-A', name: 'Tiếng Việt Nữ (Neural2-A)' },
                { voice_id: 'vi-VN-Neural2-D', name: 'Tiếng Việt Nam (Neural2-D)' },
                { voice_id: 'vi-VN-Standard-A', name: 'Tiếng Việt Nữ (Standard-A)' },
                { voice_id: 'vi-VN-Standard-B', name: 'Tiếng Việt Nam (Standard-B)' },
                { voice_id: 'vi-VN-Standard-C', name: 'Tiếng Việt Nữ (Standard-C)' },
                { voice_id: 'vi-VN-Standard-D', name: 'Tiếng Việt Nam (Standard-D)' }
            ];
            this.populateVoiceSelect(this.voices);
            if (this.api.hasApiKey()) {
                this.updateCreditsDisplay({ characterLimit: 1000000, characterCount: 0 });
            } else {
                document.getElementById('creditsText').textContent = 'Chưa cấu hình Google API';
                document.getElementById('footerCredits').textContent = '--/--';
            }
        } else {
            this.api = this.elevenLabsApi;
            this.processor.api = this.api;
            if (this.api.hasApiKey()) {
                this.connectAndLoadVoices();
            } else {
                this.voices = [];
                this.populateVoiceSelect([]);
                document.getElementById('creditsText').textContent = 'Chưa kết nối';
            }
        }
        this.saveSettings();
    }

    saveGoogleApiKey() {
        const key = document.getElementById('googleApiKeyInput').value.trim();
        if (!key) {
            this.showToast('Vui lòng nhập API key', 'warning');
            return;
        }
        this.googleApi.setApiKey(key);
        this.hideGoogleApiKeyModal();
        this.showToast('✅ Đã lưu Google API key', 'success');
        this.switchTtsProvider('google');
    }

    hideGoogleApiKeyModal() {
        const modal = document.getElementById('googleApiKeyModal');
        if (modal) modal.classList.remove('active');
    }

    async handleVideoAssetsImport(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        for (const file of files) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'mp3') {
                this.videoAudioBlob = file;
                this.showToast(`🎵 Đã tải Audio: ${file.name}`, 'success');
            } else if (ext === 'txt' || ext === 'srt') {
                try {
                    const content = await this.readFile(file);
                    this.videoPromptList = SubtitleParser.parseImagePrompts(content);
                    if (this.videoPromptList.length > 0) {
                        this.showToast(`📄 Đã tải Prompts: ${this.videoPromptList.length} phân cảnh`, 'success');
                    } else {
                        this.showToast(`File không đúng định dạng [MM:SS] prompt`, 'error');
                    }
                } catch (err) {
                    this.showToast(`Lỗi đọc file: ${err.message}`, 'error');
                }
            }
        }

        this.renderVideoPromptList();

        if (this.videoAudioBlob && this.videoPromptList.length > 0) {
            document.getElementById('btnStartVideo').disabled = false;
        }

        e.target.value = '';
    }

    renderVideoPromptList() {
        const list = document.getElementById('promptList');
        if (!this.videoPromptList || this.videoPromptList.length === 0) {
            list.innerHTML = `<div class="empty-state"><h4>Chưa có dữ liệu Video</h4><p>Tải file mp3 và file txt lên</p></div>`;
            return;
        }

        let html = '';
        this.videoPromptList.forEach((item, idx) => {
            html += `<div class="subtitle-item" id="video-prompt-${idx}" style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding-bottom: 12px;">
                <div style="display:flex; width:100%; align-items:center; gap: 12px;">
                    <span class="sub-index" style="min-width:60px;">${item.timeString}</span>
                    <span class="sub-text" style="flex:1;">${this.escapeHtml(item.prompt)}</span>
                    <span class="sub-status pending" id="video-status-${idx}">⏳ Chờ</span>
                    <button class="btn btn-sm btn-override-img" data-idx="${idx}" style="display:${this.localImages && this.localImages[idx] ? 'block' : 'none'}; padding: 4px 8px; font-size: 0.75rem; background: var(--surface-glass); border: 1px solid var(--border-glass); border-radius: 4px; cursor: pointer;">🔄 Đổi ảnh</button>
                </div>
                <div id="video-img-container-${idx}" style="width: 100%; display: ${this.localImages && this.localImages[idx] ? 'block' : 'none'}; text-align: center; margin-top: 5px;">
                    <img id="video-img-${idx}" src="${this.localImages && this.localImages[idx] ? URL.createObjectURL(this.localImages[idx]) : ''}" style="max-height: 180px; border-radius: 8px; border: 1px solid var(--border-glass);" />
                </div>
            </div>`;
        });
        list.innerHTML = html;
    }

    clearVideoList() {
        this.videoAudioBlob = null;
        this.videoPromptList = [];
        this.localImages = []; // Reset local images
        this.renderVideoPromptList();
        document.getElementById('btnStartVideo').disabled = true;
        document.getElementById('resultVideoPlayer').style.display = 'none';
        document.getElementById('btnDownloadVideo').style.display = 'none';
        const localInput = document.getElementById('localImageFolderInput');
        if (localInput) localInput.value = '';
        const localStatus = document.getElementById('localImageStatus');
        if (localStatus) localStatus.textContent = 'Chưa chọn thư mục nào.';
    }

    handleSingleImageOverride(e) {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        const idx = parseInt(this.currentOverrideIdx);
        if (!isNaN(idx) && this.localImages) {
            this.localImages[idx] = file;
            const imgUrl = URL.createObjectURL(file);
            const imgEl = document.getElementById(`video-img-${idx}`);
            const containerEl = document.getElementById(`video-img-container-${idx}`);
            const btnOverride = document.querySelector(`.btn-override-img[data-idx="${idx}"]`);
            if (imgEl && containerEl) {
                imgEl.src = imgUrl;
                containerEl.style.display = 'block';
                if (btnOverride) btnOverride.style.display = 'block';
            }
            this.showToast(`Đã thay đổi ảnh cho phân cảnh ${idx + 1}`, 'success');
        }
        e.target.value = '';
    }

    handleLocalImageFolderImport(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) {
            this.showToast('Không tìm thấy file ảnh nào trong thư mục!', 'error');
            return;
        }

        const totalDocs = this.videoPromptList ? this.videoPromptList.length : 0;
        const statusEl = document.getElementById('localImageStatus');
        if (statusEl) statusEl.textContent = `Đã tải ${imageFiles.length} ảnh. Đang tự động khớp...`;

        this.localImages = new Array(totalDocs).fill(null);

        if (totalDocs > 0) {
            const assignedFiles = new Set();
            let exactMatches = 0;
            let numberMatches = 0;

            // Bước 0: Ưu tiên khớp theo SỐ THỨ TỰ ở đầu tên file (nếu có)
            // Hỗ trợ định dạng: "01_...", "1 - ...", "005_..."
            imageFiles.forEach((f, fIdx) => {
                const match = f.name.match(/^0*(\d+)[_\-\s]/);
                if (match) {
                    const seqNum = parseInt(match[1]);
                    // Nếu số thứ tự hợp lệ (từ 1 đến tổng số prompt) và prompt đó chưa được gán
                    if (seqNum >= 1 && seqNum <= totalDocs && !this.localImages[seqNum - 1]) {
                        this.localImages[seqNum - 1] = f;
                        assignedFiles.add(fIdx);
                        numberMatches++;
                    }
                }
            });

            // Nếu vẫn còn file và prompt chưa được gán, dùng AI TF-IDF để khớp phần còn lại
            if (numberMatches < totalDocs && assignedFiles.size < imageFiles.length) {
                const stopWords = new Set(['a', 'an', 'the', 'of', 'in', 'to', 'with', 'and', 'is', 'for', 'on', 'at', 'by', 'it', 'this', 'that', 'from', 'no']);

                const tokenize = (text) => {
                    return text.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 0 && !stopWords.has(w));
                };

                const parsedPrompts = this.videoPromptList.map(item => tokenize(item.prompt));
                const parsedFiles = imageFiles.map(f => {
                    const cleanName = f.name.replace(/\.[^/.]+$/, "").replace(/_202[0-9]{9,}/g, '');
                    return tokenize(cleanName);
                });

                const wordFreq = {};
                parsedPrompts.forEach((words, pIdx) => {
                    if (this.localImages[pIdx]) return; // Bỏ qua prompt đã có ảnh
                    const uniqueWords = [...new Set(words)];
                    uniqueWords.forEach(w => {
                        wordFreq[w] = (wordFreq[w] || 0) + 1;
                    });
                });

                const getScore = (fTokens, pTokens) => {
                    let score = 0;
                    for (const fw of fTokens) {
                        if (pTokens.includes(fw)) {
                            const freq = wordFreq[fw] || 1;
                            score += (totalDocs / freq);
                        }
                    }
                    return score;
                };

                const pairs = [];
                for (let pIdx = 0; pIdx < totalDocs; pIdx++) {
                    if (this.localImages[pIdx]) continue; // Đã gán theo số
                    for (let fIdx = 0; fIdx < parsedFiles.length; fIdx++) {
                        if (assignedFiles.has(fIdx)) continue; // Đã gán theo số
                        const score = getScore(parsedFiles[fIdx], parsedPrompts[pIdx]);
                        if (score > 0) {
                            pairs.push({ pIdx, fIdx, score });
                        }
                    }
                }

                pairs.sort((a, b) => b.score - a.score);

                for (const pair of pairs) {
                    if (!this.localImages[pair.pIdx] && !assignedFiles.has(pair.fIdx)) {
                        this.localImages[pair.pIdx] = imageFiles[pair.fIdx];
                        assignedFiles.add(pair.fIdx);
                        exactMatches++;
                    }
                }
            }

            // Với các prompt chưa có ảnh, gán đại các file còn dư
            const remainingFiles = [];
            for (let fIdx = 0; fIdx < imageFiles.length; fIdx++) {
                if (!assignedFiles.has(fIdx)) remainingFiles.push(imageFiles[fIdx]);
            }
            
            let remainIdx = 0;
            for (let pIdx = 0; pIdx < totalDocs; pIdx++) {
                if (!this.localImages[pIdx] && remainIdx < remainingFiles.length) {
                    this.localImages[pIdx] = remainingFiles[remainIdx++];
                }
            }
            
            this.renderVideoPromptList();
            
            this.videoPromptList.forEach((item, idx) => {
                if (this.localImages[idx]) {
                    const statusEl = document.getElementById(`video-status-${idx}`);
                    if (statusEl) {
                        statusEl.className = 'sub-status done';
                        // Kiểm tra xem nó được gán bằng cách nào
                        const f = this.localImages[idx];
                        const match = f.name.match(/^0*(\d+)[_\-\s]/);
                        const isNumberMatch = match && parseInt(match[1]) === idx + 1;
                        
                        if (isNumberMatch) {
                            statusEl.textContent = '✅ Khớp số thứ tự (100%)';
                        } else if (assignedFiles.has(imageFiles.indexOf(f))) {
                            statusEl.textContent = '✅ Tự động khớp (AI)';
                        } else {
                            statusEl.textContent = '⚠️ Khớp tạm (Điểm = 0)';
                        }
                    }
                }
            });

            if (numberMatches > 0) {
                this.showToast(`Khớp tuyệt đối ${numberMatches}/${totalDocs} ảnh nhờ Số thứ tự!`, 'success');
            } else {
                this.showToast(`AI đã phân tích và khớp chính xác ${exactMatches}/${totalDocs} ảnh!`, 'success');
            }
        } else {
            this.localImages = imageFiles;
            this.showToast(`Đã chọn ${imageFiles.length} ảnh. Hãy tải lên file Prompts để tự động khớp!`, 'info');
        }
    }

    async startVideoRender() {
        const imageProvider = document.getElementById('imageProviderSelect')?.value || 'pollinations';
        
        if (imageProvider === 'gemini') {
            const apiKey = document.getElementById('geminiApiKey').value.trim();
            if (!apiKey) {
                this.showToast('Vui lòng nhập Gemini API Key', 'warning');
                return;
            }
            window.ImageGenerator.setApiKey(apiKey);
        } else if (imageProvider === 'local') {
            if (!this.localImages || this.localImages.length === 0) {
                this.showToast('Vui lòng chọn thư mục chứa ảnh trước!', 'warning');
                return;
            }
        }
        
        const aspectRatio = document.getElementById('imageAspectRatio')?.value || '16:9';
        const statusEl = document.getElementById('ffmpegStatus');

        try {
            document.getElementById('btnStartVideo').disabled = true;
            statusEl.textContent = '1/3: Đang tạo hình ảnh...';
            statusEl.style.color = 'var(--info)';

            const generatedImages = [];

            for (let i = 0; i < this.videoPromptList.length; i++) {
                const item = this.videoPromptList[i];
                const itemStatus = document.getElementById(`video-status-${i}`);
                itemStatus.className = 'sub-status processing';
                itemStatus.textContent = '🔄 Đang xử lý';

                let imgBlob;
                if (imageProvider === 'local') {
                    if (i < this.localImages.length) {
                        imgBlob = this.localImages[i];
                    } else {
                        throw new Error(`Thiếu ảnh cho phân cảnh ${i + 1}. Tải lên ${this.localImages.length} ảnh nhưng có ${this.videoPromptList.length} cảnh.`);
                    }
                } else if (imageProvider === 'pollinations') {
                    imgBlob = await window.ImageGenerator.generateImagePollinations(item.prompt, aspectRatio);
                } else {
                    imgBlob = await window.ImageGenerator.generateImage(item.prompt, aspectRatio);
                }
                
                generatedImages.push({
                    timestamp: item.timestamp,
                    blob: imgBlob
                });

                // Hiển thị ảnh trên giao diện ngay lập tức
                const containerEl = document.getElementById(`video-img-container-${i}`);
                const imgEl = document.getElementById(`video-img-${i}`);
                if (containerEl && imgEl) {
                    imgEl.src = URL.createObjectURL(imgBlob);
                    containerEl.style.display = 'block';
                }

                itemStatus.className = 'sub-status done';
                itemStatus.textContent = '✅ Xong';

                statusEl.textContent = `Đang tạo ảnh ${i + 1}/${this.videoPromptList.length}...`;
            }

            statusEl.textContent = '2/3: Đang tải FFmpeg...';
            const audioDuration = await this.getAudioDuration(this.videoAudioBlob);

            await window.VideoRenderer.load((msg) => {
                statusEl.textContent = msg;
            });

            statusEl.textContent = '3/3: Đang Render Video...';
            const mp4Blob = await window.VideoRenderer.render(this.videoAudioBlob, generatedImages, audioDuration);

            this.resultVideoBlob = mp4Blob;
            const player = document.getElementById('resultVideoPlayer');
            player.src = URL.createObjectURL(mp4Blob);
            player.style.display = 'block';

            document.getElementById('btnDownloadVideo').style.display = 'flex';
            statusEl.textContent = '✅ Render Video Hoàn tất!';
            statusEl.style.color = 'var(--success)';
            this.showToast('Tạo video thành công!', 'success');

        } catch (err) {
            console.error(err);
            statusEl.textContent = `❌ Lỗi: ${err.message}`;
            statusEl.style.color = 'var(--error)';
            this.showToast(`Lỗi: ${err.message}`, 'error');
        } finally {
            document.getElementById('btnStartVideo').disabled = false;
        }
    }

    getAudioDuration(blob) {
        return new Promise((resolve) => {
            const audio = new Audio(URL.createObjectURL(blob));
            audio.addEventListener('loadedmetadata', () => {
                resolve(audio.duration);
            });
            audio.addEventListener('error', () => {
                resolve(60); // fallback
            });
        });
    }

    downloadVideo() {
        if (!this.resultVideoBlob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(this.resultVideoBlob);
        a.download = `rendered_video_${Date.now()}.mp4`;
        a.click();
    }

    // ============ Utility ============

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// ============ Initialize App ============
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
