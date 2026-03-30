# Changelog

All notable changes to the InstruMatic Home Assistant integration will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.3] - 2026-03-30

### ✨ Added
- Welcome screen for new users (similar to mobile app)
- HMAC secret obfuscation for better security
- App version now loads from manifest.json
- HACS validation GitHub Actions
- Hassfest validation GitHub Actions
- MIT License
- HACS setup documentation
- README with English translation
- Screenshots for documentation
- Integration icon (48x48)
- HACS banner (1280x640)

### 🐛 Fixed
- Fixed XOR encoding for HMAC secret
- Improved signature generation for API requests

### 🔧 Changed
- Moved HMAC secret from `const.py` to `__init__.py`
- Updated repository structure for HACS compliance

## [1.1.2] - 2026-03-15

### ✨ Added
- Initial Home Assistant integration release
- Calendar integration for maintenance schedules
- Sensor entities for equipment status
- Configuration flow with UI
- Multi-language support (EN/RU)
- Backend API integration with InstruMatic service

### 🔧 Technical
- Initial project structure
- Basic documentation

---

## Version History Summary

| Version | Date | Description |
|---------|------|-------------|
| 1.1.3 | 2026-03-30 | HACS publishing preparation, security improvements |
| 1.1.2 | 2026-03-15 | Initial HA integration release |

---

**Repository:** https://github.com/AndreiNikolaev/InstruMatic_HA

**License:** MIT
