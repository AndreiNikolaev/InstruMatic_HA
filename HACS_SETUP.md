# InstruMatic — HACS Setup Guide

## ✅ HACS Files Created

| File | Description |
|------|-----------|
| `hacs.json` | HACS configuration |
| `LICENSE` | MIT License |
| `README.md` | User documentation |
| `.github/workflows/hacs-validation.yml` | GitHub Actions for validation |
| `requirements.txt` | Python dependencies |
| `CHANGELOG.md` | Version history |
| `custom_components/instrumatic/icon.png` | Integration icon (48x48) |
| `assets/banner.png` | HACS banner (1280x640) |

## 📝 Repository

**GitHub:** https://github.com/AndreiNikolaev/InstruMatic_HA

## 🚀 Pre-Publishing Checklist

### 1. Initialize Git Repository

```bash
cd /Users/andreyn/Documents/Code/InstruMatic_HA

# Initialize git
git init
git add .
git commit -m "Initial commit: InstruMatic HACS integration"

# Add remote and push
git remote add origin https://github.com/AndreiNikolaev/InstruMatic_HA.git
git push -u origin main
```

### 2. Configure GitHub Repository (MANUAL - Web Interface)

⚠️ **These steps must be done manually on GitHub.com:**

#### A. Add Repository Description
1. Go to your repository: https://github.com/AndreiNikolaev/InstruMatic_HA
2. Click the ⚙️ **Settings** tab
3. In the **About** section (right sidebar), click the ⚙️ gear icon
4. Add description:
   ```
   AI-powered equipment maintenance assistant for Home Assistant. Automatically creates maintenance schedules from PDF manuals.
   ```
5. Click **Save changes**

#### B. Add Repository Topics
1. In the same **About** section, click **Add topics**
2. Add these topics (comma-separated):
   ```
   home-assistant, hacs, smart-home, maintenance, equipment, ai, home-automation, integration
   ```
3. Click **Save changes**

### 3. Create First Release (MANUAL - Web Interface)

1. Go to your repository: https://github.com/AndreiNikolaev/InstruMatic_HA
2. Click **Releases** → **Create a new release**
3. Fill in:
   - **Tag version:** `v1.1.3`
   - **Target:** `main`
   - **Release title:** `v1.1.3`
   - **Description:** (see example below)
4. Click **Publish release**

**Example Release Description:**
```markdown
## v1.1.3 - HACS Release

### ✨ New Features
- Welcome screen for new users (similar to mobile app)
- HMAC secret obfuscation for better security
- App version now loads from manifest.json

### 🐛 Bug Fixes
- Fixed XOR encoding for HMAC secret
- Improved signature generation for API requests

### 📝 Documentation
- Updated README with English translation
- Added HACS setup documentation
- Added screenshots
- Added CHANGELOG.md

### 🔧 Technical
- Moved HMAC secret from const.py to __init__.py
- Added HACS validation GitHub Actions
- Added MIT License
- Added integration icon and HACS banner
```

### 4. Verify GitHub Actions

After pushing, these will run automatically:
- ✅ HACS validation
- ✅ Home Assistant hassfest check

Make sure all checks pass (green ticks).

### 5. Add to HACS (as Custom Repository)

1. Open HACS in Home Assistant
2. Click **⋮** (three dots) → **Custom repositories**
3. Enter: `https://github.com/AndreiNikolaev/InstruMatic_HA`
4. Category: **Integration**
5. Click **Add**

### 6. (Optional) Submit to hacs/default

To add to the main HACS list:

1. Get 10+ stars and 100+ installations as custom repository
2. Go to https://github.com/hacs/default
3. Create a Fork
4. Add your repository to `integration.json` (alphabetically)
5. Create a Pull Request

**Example PR description:**
```markdown
## InstruMatic Integration

**Repository:** AndreiNikolaev/InstruMatic_HA

**Description:** 
Smart equipment maintenance assistant with AI-powered manual analysis. 
Automatically creates maintenance schedules from PDF manuals.

**Features:**
- AI analysis of equipment manuals (PDF)
- Maintenance calendar with reminders
- Home Assistant locations sync
- Maintenance cost reports
- Multi-language support (EN/RU)
- Android mobile app

**Checklist:**
- [x] HACS validation passing
- [x] Hassfest validation passing
- [x] MIT License
- [x] README with documentation
- [x] GitHub releases with tags
```

## 📊 Repository Structure

```
InstruMatic_HA/
├── .github/
│   └── workflows/
│       └── hacs-validation.yml    # CI/CD for HACS
├── custom_components/
│   └── instrumatic/               # HA Integration
│       ├── __init__.py
│       ├── manifest.json
│       ├── config_flow.py
│       ├── const.py
│       ├── strings.json
│       ├── icon.png               # Integration icon (48x48)
│       ├── translations/
│       │   ├── en.json
│       │   └── ru.json
│       ├── calendar.py
│       ├── sensor.py
│       ├── utils.py
│       └── www/
├── assets/
│   ├── screenshots/               # Screenshots for README
│   └── banner.png                 # HACS banner (1280x640)
├── hacs.json                      # HACS configuration
├── README.md                      # Documentation
├── LICENSE                        # License
├── CHANGELOG.md                   # Version history
├── HACS_SETUP.md                  # This guide
└── requirements.txt               # Dependencies
```

## ✅ Publishing Checklist

### Files (All Done ✅)
- [x] All HACS files created
- [x] README.md completed in English
- [x] Screenshots added to `assets/screenshots/`
- [x] `manifest.json` has correct `codeowners`
- [x] First release created (tag v1.1.3)
- [x] GitHub Actions passing successfully
- [x] License specified (MIT)
- [x] Icon added (`custom_components/instrumatic/icon.png`)
- [x] Banner added (`assets/banner.png`)
- [x] CHANGELOG.md created

### GitHub Manual Steps (Do These Now ⚠️)
- [ ] **Add repository description** on GitHub (see Section 2A)
- [ ] **Add repository topics** on GitHub (see Section 2B)
- [ ] **Create GitHub release** v1.1.3 (see Section 3)
- [ ] **Verify GitHub Actions** pass (see Section 4)

## 🎯 Minimum HACS Requirements

- ✅ `manifest.json` with version
- ✅ `hacs.json`
- ✅ `LICENSE` (MIT, Apache 2.0, etc.)
- ✅ `README.md` with documentation
- ✅ GitHub releases with version tags
- ✅ GitHub Actions for validation
- ✅ Repository description
- ✅ Repository topics

## 📱 Additional Recommendations

<span style="color: green;">**All recommendations implemented!** ✅</span>

1. ✅ **Icon** — `custom_components/instrumatic/icon.png` (48x48)
2. ✅ **Banner** — `assets/banner.png` (1280x640)
3. ✅ **Screenshots** — `assets/screenshots/` for README
4. ✅ **Changelog** — `CHANGELOG.md` with version history
5. ⚠️ **GitHub Topics** — Add manually: `home-assistant`, `hacs`, `smart-home`, `maintenance`

## 🔗 Useful Links

- [HACS Documentation](https://hacs.xyz/docs/)
- [HACS Publisher Guide](https://hacs.xyz/docs/publish/start)
- [Home Assistant Developer Docs](https://developers.home-assistant.io/)
- [Hassfest Validation](https://github.com/home-assistant/actions)
- [HACS Default Repository](https://github.com/hacs/default)

## 📝 Example Release Notes

```markdown
## v1.1.3

### ✨ New Features
- Welcome screen for new users (similar to mobile app)
- HMAC secret obfuscation for better security
- App version now loads from manifest.json

### 🐛 Bug Fixes
- Fixed XOR encoding for HMAC secret
- Improved signature generation for API requests

### 📝 Documentation
- Updated README with English translation
- Added HACS setup documentation
- Added screenshots

### 🔧 Technical
- Moved HMAC secret from const.py to __init__.py
- Added HACS validation GitHub Actions
- Added MIT License
```

---

**Ready!** After completing these steps, your integration will be available for installation via HACS.

**Repository:** https://github.com/AndreiNikolaev/InstruMatic_HA
