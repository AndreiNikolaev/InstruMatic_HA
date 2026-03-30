"""Constants for InstruMatic integration."""

DOMAIN = "instrumatic"

# Supported platforms
PLATFORMS = ["calendar", "sensor"]

# Keys for storing data in hass.data
DATA_STORAGE = "instrumatic_storage"
DATA_COORDINATOR = "instrumatic_coordinator"

# Constants for data versioning
STORAGE_VERSION = 1
STORAGE_KEY = "instrumatic.storage"

# Backend configuration
BACKEND_URL = "http://192.168.50.183:8000/"  # Local backend
# BACKEND_URL = "http://192.168.50.2:8000/"  # Local backend (localhost)
# BACKEND_URL = "https://api.instrumatic.ru/"  # Cloud backend
