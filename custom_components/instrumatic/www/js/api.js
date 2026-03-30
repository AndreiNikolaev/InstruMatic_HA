export const Api = {
    async _fetch(url, options = {}) {
        const res = await fetch(url, options);
        if (!res.ok) {
            // Try to read response as text first to see full error
            const errorText = await res.text();
            console.error('[API] Error response:', {
                status: res.status,
                statusText: res.statusText,
                url: url,
                method: options.method,
                body: options.body,
                headers: options.headers,
                errorText: errorText
            });
            
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                throw new Error(errorText || `HTTP error! status: ${res.status}`);
            }
            throw new Error(errorData.detail || errorData.error || `HTTP error! status: ${res.status}`);
        }
        return await res.json();
    },

    async getData() {
        // Get language from multiple sources
        let lang = 'en';
        try {
            // Method 1: Try window.hass (works in native panels)
            if (window.hass && window.hass.language) {
                lang = window.hass.language.split('-')[0];
                console.log('[Language] From window.hass.language:', lang);
            }
            // Method 2: Try parent window (if in iframe)
            else if (window.parent && window.parent.hass && window.parent.hass.language) {
                lang = window.parent.hass.language.split('-')[0];
                console.log('[Language] From parent window:', lang);
            }
            // Method 3: Try URL parameter (passed from parent)
            else {
                const urlParams = new URLSearchParams(window.location.search);
                const paramLang = urlParams.get('lang');
                if (paramLang && ['ru', 'en'].includes(paramLang)) {
                    lang = paramLang;
                    console.log('[Language] From URL parameter:', lang);
                }
            }
        } catch (e) {
            console.warn('[Language] Failed to get HA language:', e);
        }
        console.log('[Language] Using language:', lang);
        // Add timestamp and language to prevent caching and pass user language
        return await this._fetch(`/api/instrumatic/data?t=${Date.now()}&lang=${lang}`);
    },

    async loadTranslations(lang) {
        const res = await fetch(`/instrumatic/translations/${lang}.json`);
        if (res.ok) return await res.json();
        return null;
    },

    async searchInstructions(query, lang) {
        return await this._fetch('/api/instrumatic/proxy/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, language: lang })
        });
    },

    async startAnalysis(text, modelName, lang) {
        return await this._fetch('/api/instrumatic/proxy/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, user_model: modelName, language: lang })
        });
    },

    async checkJobStatus(jobId) {
        if (!jobId || jobId === 'undefined') {
            throw new Error("Invalid Job ID");
        }
        return await this._fetch(`/api/instrumatic/proxy/jobs/${jobId}`);
    },

    async proxyRequest(method, path, body) {
        return await this._fetch(`/api/instrumatic/proxy/${path}`, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : null
        });
    },

    async saveEquipment(action, type, payload) {
        return await this._fetch('/api/instrumatic/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, type, payload })
        });
    },

    async downloadFile(url) {
        const res = await fetch(`/api/instrumatic/download?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return await res.arrayBuffer();
    }
};
