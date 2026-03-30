# Changelog

All notable changes to the InstruMatic Home Assistant integration will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.3] - 2026-03-30

### ✨ Added
- Initial Home Assistant integration release
- Calendar integration for maintenance schedules
- Sensor entities for equipment status
- Configuration flow with UI
- Multi-language support (EN/RU)
- Backend API integration with InstruMatic service

### 🐛 Fixed
- Fixed XOR encoding for HMAC secret
- Improved signature generation for API requests

### 🔧 Changed
- Moved HMAC secret from `const.py` to `__init__.py`
- Updated repository structure for HACS compliance

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
