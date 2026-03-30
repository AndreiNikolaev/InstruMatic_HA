/**
 * InstruMatic Home Assistant Custom Panel
 * Shadow DOM version with proper styling
 */
class InstruMaticPanel extends HTMLElement {
    constructor() {
        super();
        this._initialized = false;
    }

    set hass(hass) {
        this._hass = hass;
    }

    async connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Create Shadow DOM with open mode for debugging
        const shadow = this.attachShadow({ mode: 'open' });

        // Add base styles for layout with HA CSS variables
        const baseStyle = document.createElement('style');
        baseStyle.textContent = `
            :host {
                display: flex;
                flex-direction: column;
                height: 100%;
                width: 100%;
                overflow: hidden;
                /* HA CSS Variables fallback */
                --ha-primary-color: #03a9f4;
                --ha-card-background: #ffffff;
                --ha-background-color: #f5f5f5;
                --ha-text-primary-color: #212121;
                --ha-text-secondary-color: #757575;
                --ha-divider-color: #e0e0e0;
                --ha-error-color: #db4437;
                --ha-warning-color: #ffa600;
                --ha-success-color: #43a047;
            }
            @media (prefers-color-scheme: dark) {
                :host {
                    --ha-card-background: #1c1c1c;
                    --ha-background-color: #101010;
                    --ha-text-primary-color: #e1e1e1;
                    --ha-text-secondary-color: #b0b0b0;
                    --ha-divider-color: #303030;
                }
            }
            /* Material Icons font */
            @font-face {
                font-family: 'Material Icons';
                font-style: normal;
                font-weight: 400;
                src: url(https://fonts.gstatic.com/s/materialicons/v145/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2) format('woff2');
            }
            .material-icons {
                font-family: 'Material Icons';
                font-weight: normal;
                font-style: normal;
                font-size: 24px;
                line-height: 1;
                letter-spacing: normal;
                text-transform: none;
                display: inline-block;
                white-space: nowrap;
                word-wrap: normal;
                direction: ltr;
                -webkit-font-feature-settings: 'liga';
                -webkit-font-smoothing: antialiased;
            }
            #app-mount {
                flex: 1;
                display: flex;
                flex-direction: column;
                height: 100%;
                width: 100%;
                overflow: hidden;
                background-color: var(--ha-background-color);
                color: var(--ha-text-primary-color);
            }
            .loading-msg {
                padding: 40px;
                text-align: center;
                font-family: sans-serif;
                color: #888;
            }
            .error-msg {
                padding: 20px;
                color: #db4437;
                background: var(--ha-card-background);
                border: 1px solid #db4437;
                margin: 20px;
                border-radius: 12px;
                font-family: sans-serif;
            }
        `;
        shadow.appendChild(baseStyle);

        const mount = document.createElement('div');
        mount.id = 'app-mount';
        mount.innerHTML = `<div class="loading-msg">Загрузка InstruMatic...</div>`;
        shadow.appendChild(mount);

        try {
            // 1. Load Dependencies
            const libs = [
                'https://unpkg.com/vue@3/dist/vue.global.js',
                'https://unpkg.com/dayjs@1.11.10/dayjs.min.js',
                'https://unpkg.com/dayjs@1.11.10/locale/ru.js',
                'https://unpkg.com/dayjs@1.11.10/plugin/customParseFormat.js',
                'https://unpkg.com/dayjs@1.11.10/plugin/localizedFormat.js',
                'https://unpkg.com/dayjs@1.11.10/plugin/relativeTime.js',
                'https://unpkg.com/dayjs@1.11.10/plugin/isBetween.js',
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            ];
            for (const lib of libs) {
                await this._loadScript(lib);
            }

            if (window.dayjs) {
                dayjs.extend(window.dayjs_plugin_customParseFormat);
                dayjs.extend(window.dayjs_plugin_localizedFormat);
                dayjs.extend(window.dayjs_plugin_relativeTime);
                dayjs.extend(window.dayjs_plugin_isBetween);
            }

            // Load Material Icons font in main document (not Shadow DOM) for CORS
            const fontLink = document.createElement('link');
            fontLink.rel = 'stylesheet';
            fontLink.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
            document.head.appendChild(fontLink);
            console.log('[Panel] Material Icons font loaded in main document');

            // 2. Fetch the template and styles from index.html
            const response = await fetch('/instrumatic/static/index.html');
            if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to fetch index.html`);
            const html = await response.text();

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 3. Inject ALL styles from index.html into Shadow DOM
            // Search in both head and body
            const styles = [...doc.querySelectorAll('head style'), ...doc.querySelectorAll('body style')];
            console.log('[Panel] Found', styles.length, 'style tags');
            styles.forEach((s, i) => {
                const style = document.createElement('style');
                style.textContent = s.textContent;
                shadow.appendChild(style);
                console.log('[Panel] Injected style', i);
            });

            // 5. Inject the app template
            const appTemplate = doc.querySelector('#app');
            if (appTemplate) {
                mount.innerHTML = '';
                const appDiv = appTemplate.cloneNode(true);
                appDiv.removeAttribute('v-cloak');
                appDiv.style.display = 'flex';
                appDiv.style.flexDirection = 'column';
                appDiv.style.height = '100%';
                mount.appendChild(appDiv);

                // Set global mount point for app.js
                window.INSTRUMATIC_MOUNT_POINT = appDiv;
                
                // Expose hass to the app (critical for language detection)
                window.hass = this._hass;
                console.log('[Panel] hass exposed to window:', this._hass?.language);

                // 6. Load the app logic as a module with language parameter
                const script = document.createElement('script');
                script.type = 'module';
                const userLang = this._hass?.language || 'en';
                script.src = `/instrumatic/static/js/app.js?v=${Date.now()}&lang=${userLang}`;
                document.head.appendChild(script);
            } else {
                throw new Error("Could not find #app container in index.html");
            }
        } catch (e) {
            mount.innerHTML = `<div class="error-msg">
                <b>Ошибка инициализации:</b><br>${e.message}
            </div>`;
            console.error("InstruMatic Panel Error:", e);
        }
    }

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) return resolve();
            const s = document.createElement('script');
            s.src = src;
            s.async = false;
            s.onload = resolve;
            s.onerror = () => reject(new Error(`Failed to load dependency: ${src}`));
            document.head.appendChild(s);
        });
    }
}

customElements.define('instrumatic-panel', InstruMaticPanel);
