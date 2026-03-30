"""Инициализация интеграции InstruMatic."""
from __future__ import annotations

import logging
import os
import uuid
import time
import hmac
import hashlib
import json
import asyncio
from datetime import datetime, timedelta

import aiohttp
from aiohttp import web
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.components import frontend
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, PLATFORMS, DATA_STORAGE, DATA_COORDINATOR, STORAGE_KEY, STORAGE_VERSION, BACKEND_URL
from .utils import update_all_next_maintenance, update_equipment_next_maintenance

_LOGGER = logging.getLogger(__name__)

# Obfuscated HMAC secret (XOR encoded)
_HMAC_OBFUSCATED = [0x0a, 0x7f, 0x0e, 0x02, 0x72, 0x17, 0x7f, 0x06, 0x16, 0x7f, 
                    0x05, 0x7d, 0x01, 0x01, 0x7e, 0x06, 0x74, 0x08, 0x19, 0x72, 
                    0x08, 0x70, 0x0c, 0x15, 0x6f, 0x13, 0x7c]
_XOR_KEY = [0x42, 0x37, 0x4A, 0x51, 0x38]
HMAC_SECRET = ''.join(chr(_HMAC_OBFUSCATED[i] ^ _XOR_KEY[i % len(_XOR_KEY)]) 
                      for i in range(len(_HMAC_OBFUSCATED)))

SIGNAL_EQUIPMENT_UPDATED = f"{DOMAIN}_equipment_updated"

async def _get_sanitized_data(store: Store) -> dict:
    """Load and sanitize data from storage."""
    data = await store.async_load()
    if data is None:
        data = {}
    defaults = {
        "properties": [{"id": "default", "name": "Мой дом"}],
        "equipment": [],
        "tasks": [],
        "components": [],
        "history": [],
        "locations": []
    }
    for key, val in defaults.items():
        if key not in data or not isinstance(data[key], list):
            data[key] = val

    # Ensure next maintenance is up to date on load
    update_all_next_maintenance(data)
    return data

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up InstruMatic from a config entry."""
    _LOGGER.info("Setting up InstruMatic integration")
    hass.data.setdefault(DOMAIN, {})
    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)

    async def async_update_data():
        return await _get_sanitized_data(store)

    coordinator = DataUpdateCoordinator(
        hass, _LOGGER, name=DOMAIN,
        update_method=async_update_data,
        update_interval=timedelta(minutes=5),
    )
    await coordinator.async_refresh()

    hass.data[DOMAIN][entry.entry_id] = {
        DATA_STORAGE: store,
        DATA_COORDINATOR: coordinator
    }

    if "view_registered" not in hass.data[DOMAIN]:
        hass.http.register_view(InstruMaticApiView(store, coordinator))
        hass.http.register_view(InstruMaticProxyView(store, coordinator))
        hass.http.register_view(InstruMaticDownloadView(hass))
        hass.data[DOMAIN]["view_registered"] = True

    base_path = os.path.dirname(__file__)
    www_path = os.path.join(base_path, "www")
    trans_path = os.path.join(base_path, "translations")

    await hass.http.async_register_static_paths([
        StaticPathConfig(f"/{DOMAIN}/static", www_path, False),
        StaticPathConfig(f"/{DOMAIN}/translations", trans_path, False)
    ])

    if "panel_registered" not in hass.data[DOMAIN]:
        # Ensure panel_custom is loaded properly
        from homeassistant.setup import async_setup_component
        await async_setup_component(hass, "panel_custom", {})

        try:
            # Import the panel_custom component to use its registration function
            from homeassistant.components import panel_custom

            # Register native panel (not iframe)
            await panel_custom.async_register_panel(
                hass=hass,
                frontend_url_path=DOMAIN,
                webcomponent_name="instrumatic-panel",
                sidebar_title="InstruMatic",
                sidebar_icon="mdi:wrench-clock",
                module_url=f"/{DOMAIN}/static/instrumatic-panel.js",
                require_admin=False
            )
            hass.data[DOMAIN]["panel_registered"] = True
            _LOGGER.info("✅ InstruMatic native panel registered successfully")
        except Exception as err:
            _LOGGER.error("❌ Failed to register native panel: %s", err)
            raise

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True

class InstruMaticApiView(HomeAssistantView):
    """API for managing InstruMatic data."""
    url = "/api/instrumatic/data"
    name = "api:instrumatic:data"
    requires_auth = False

    def __init__(self, store, coordinator):
        self.store = store
        self.coordinator = coordinator

    async def get(self, request):
        """Get all data."""
        data = await _get_sanitized_data(self.store)
        hass = self.coordinator.hass

        # Get language from query parameter (passed from HA frontend)
        # This is the most reliable way to get user's selected language from Profile
        ha_lang = request.query.get('lang', '')
        
        # Validate language
        if ha_lang and ha_lang.split('-')[0] in ['ru', 'en']:
            ha_lang = ha_lang.split('-')[0]
            _LOGGER.info("Language from query param: %s", ha_lang)
        else:
            # Fallback to system language
            ha_lang = getattr(hass.config, 'language', 'en')
            if ha_lang and ha_lang.split('-')[0] in ['ru', 'en']:
                ha_lang = ha_lang.split('-')[0]
            else:
                ha_lang = 'en'
            _LOGGER.info("Language from system config: %s", ha_lang)

        data["language"] = ha_lang
        data["user_key"] = f"ha_{hass.data['core.uuid'][:16]}"
        
        # Load version from manifest
        manifest_path = os.path.join(os.path.dirname(__file__), "manifest.json")
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
                data["version"] = manifest.get("version", "unknown")
        except Exception as e:
            _LOGGER.warning("Failed to load version from manifest: %s", e)
            data["version"] = "unknown"

        _LOGGER.info("Final language: %s", ha_lang)

        # Sync HA areas to locations
        area_reg = ar.async_get(hass)
        ha_areas = {area.name for area in area_reg.areas.values()}
        existing_locations = data.get("locations", [])
        existing_loc_names = {loc["name"] for loc in existing_locations}
        updated = False
        
        # Add new areas
        for area_name in ha_areas:
            if area_name not in existing_loc_names:
                data["locations"].append({
                    "id": str(uuid.uuid4()),
                    "propertyId": "default",
                    "name": area_name
                })
                updated = True
        
        # Remove deleted areas (only if they're not used by equipment)
        equipment_locations = {eq.get("location") for eq in data.get("equipment", []) if eq.get("location")}
        locations_to_remove = []
        for loc in existing_locations:
            loc_name = loc.get("name")
            # Only remove if: not in HA areas anymore AND not used by equipment
            if loc_name not in ha_areas and loc_name not in equipment_locations:
                locations_to_remove.append(loc)
                updated = True
        
        for loc in locations_to_remove:
            data["locations"].remove(loc)
            _LOGGER.info("Removed location '%s' (deleted from HA and not used)", loc.get("name"))

        data["ha_devices"] = await self._get_ha_devices()

        if updated:
            await self.store.async_save(data)
        return self.json(data)

    async def _get_ha_devices(self):
        """Get relevant devices from HA, matching mobile client logic."""
        hass = self.coordinator.hass
        dr_reg = dr.async_get(hass)
        er_reg = er.async_get(hass)
        ar_reg = ar.async_get(hass)

        # Matching domains from AddEquipmentViewModel.kt
        EQUIPMENT_DOMAINS = {
            "climate", "water_heater", "humidifier", "fan", "vacuum",
            "switch", "valve", "cover", "lock", "lawn_mower",
            "alarm_control_panel", "air_quality", "light", "media_player"
        }
        # Matching device classes from AddEquipmentViewModel.kt
        EQUIPMENT_CLASSES = {"gas", "water", "smoke", "moisture", "carbon_monoxide"}
        DIAGNOSTIC_CLASSES = {"battery", "connectivity", "signal_strength", "timestamp"}
        DIAGNOSTIC_DOMAINS = {"button", "number", "select", "text", "datetime", "update"}

        devices = []
        for device_id, device in dr_reg.devices.items():
            entities = er.async_entries_for_device(er_reg, device_id)
            if not entities:
                continue

            is_equipment = False
            is_diagnostic = False
            area_id = device.area_id

            for ent in entities:
                if not area_id and ent.area_id:
                    area_id = ent.area_id

                if ent.domain in EQUIPMENT_DOMAINS:
                    is_equipment = True
                if ent.domain in DIAGNOSTIC_DOMAINS:
                    is_diagnostic = True
                if ent.entity_id.endswith(("_battery", "_firmware")) or "browser_mod" in ent.entity_id:
                    is_diagnostic = True

                state = hass.states.get(ent.entity_id)
                if state:
                    dev_class = state.attributes.get("device_class")
                    if dev_class in EQUIPMENT_CLASSES:
                        is_equipment = True
                    if dev_class in DIAGNOSTIC_CLASSES:
                        is_diagnostic = True

            if is_equipment and not is_diagnostic:
                area_name = None
                if area_id:
                    area = ar_reg.areas.get(area_id)
                    if area:
                        area_name = area.name

                devices.append({
                    "id": device_id,
                    "name": device.name_by_user or device.name,
                    "brand": device.manufacturer,
                    "model": device.model,
                    "area": area_name,
                    "type": None
                })
        return devices

    async def post(self, request):
        """Save data."""
        try:
            msg = await request.json()
            action, entity_type, payload = msg.get("action"), msg.get("type"), msg.get("payload")
            data = await _get_sanitized_data(self.store)

            if action == "save":
                if not payload.get("id"):
                    payload["id"] = str(uuid.uuid4())
                    data[entity_type].append(payload)
                else:
                    for i, item in enumerate(data[entity_type]):
                        if item["id"] == payload["id"]:
                            data[entity_type][i] = payload
                            break

                # Update next maintenance for affected equipment
                if entity_type == "equipment":
                    update_equipment_next_maintenance(data, payload["id"])
                elif entity_type == "tasks":
                    update_equipment_next_maintenance(data, payload.get("equipmentId"))

            elif action == "save_batch":
                equipment = payload.get("equipment")
                tasks = payload.get("tasks", [])
                components = payload.get("components", [])

                if not equipment.get("id"):
                    equipment["id"] = str(uuid.uuid4())

                # Update equipment
                data["equipment"] = [e for e in data["equipment"] if e["id"] != equipment["id"]]
                data["equipment"].append(equipment)

                # Sync tasks
                data["tasks"] = [t for t in data["tasks"] if t.get("equipmentId") != equipment["id"]]
                for t in tasks:
                    if not t.get("id"): t["id"] = str(uuid.uuid4())
                    t["equipmentId"] = equipment["id"]
                    data["tasks"].append(t)

                # Sync components
                data["components"] = [c for c in data["components"] if c.get("equipmentId") != equipment["id"]]
                for c in components:
                    if not c.get("id"): c["id"] = str(uuid.uuid4())
                    c["equipmentId"] = equipment["id"]
                    data["components"].append(c)

                update_equipment_next_maintenance(data, equipment["id"])

            elif action == "delete":
                entity_id = payload.get("id")
                affected_equipment_id = None
                if entity_type == "tasks":
                    task = next((t for t in data["tasks"] if t["id"] == entity_id), None)
                    if task:
                        affected_equipment_id = task.get("equipmentId")

                data[entity_type] = [item for item in data[entity_type] if item["id"] != entity_id]
                if entity_type == "equipment":
                    data["tasks"] = [t for t in data["tasks"] if t.get("equipmentId") != entity_id]
                    data["components"] = [c for c in data["components"] if c.get("equipmentId") != entity_id]
                    data["history"] = [h for h in data["history"] if h.get("equipmentId") != entity_id]

                if affected_equipment_id:
                    update_equipment_next_maintenance(data, affected_equipment_id)

            elif action == "complete_task":
                task_id, history_entry = payload.get("taskId"), payload.get("history")
                history_entry["id"] = str(uuid.uuid4())

                # Ensure timestamp and completionDate
                now = datetime.now()
                if "timestamp" not in history_entry:
                    history_entry["timestamp"] = int(now.timestamp() * 1000)
                if "completionDate" not in history_entry:
                    history_entry["completionDate"] = now.strftime("%Y-%m-%d")

                data["history"].append(history_entry)

                for task in data["tasks"]:
                    if task["id"] == task_id:
                        task["lastCompletedDate"] = history_entry.get("completionDate")
                        task["lastCompletedTime"] = history_entry.get("completionTime")

                        # Clear manualNextDate as it's an override for the current occurrence
                        if "manualNextDate" in task:
                            task["manualNextDate"] = None

                        update_equipment_next_maintenance(data, task.get("equipmentId"))
                        break

            await self.store.async_save(data)
            _LOGGER.info("Data saved to storage, refreshing coordinator...")
            await self.coordinator.async_refresh()
            _LOGGER.info("Coordinator refreshed, data: %d equipment, %d tasks", 
                        len(data.get('equipment', [])), len(data.get('tasks', [])))
            async_dispatcher_send(self.coordinator.hass, SIGNAL_EQUIPMENT_UPDATED)
            return self.json({"success": True, "data": data})
        except Exception as e:
            _LOGGER.error("InstruMatic API Error: %s", e)
            return self.json({"error": str(e)}, 400)

class InstruMaticProxyView(HomeAssistantView):
    """Proxy for backend API calls."""
    url = "/api/instrumatic/proxy/{path:.*}"
    name = "api:instrumatic:proxy"
    requires_auth = False

    def __init__(self, store, coordinator):
        self.store = store
        self.coordinator = coordinator

    def _get_user_key(self):
        """Generate identical user key as mobile app."""
        return f"ha_{self.coordinator.hass.data['core.uuid'][:16]}"

    def _generate_signature(self, method, path, timestamp, body):
        """HMAC-SHA256 signature."""
        data_to_sign = f"{method}|{path}|{timestamp}|{body}"
        signature = hmac.new(
            HMAC_SECRET.encode(),
            data_to_sign.encode(),
            hashlib.sha256
        ).hexdigest()
        return signature

    async def handle(self, request, path):
        """Forward request to backend."""
        method = request.method
        backend_path = f"/api/v1/{path}"

        # Preserve query parameters from original request
        query_params = request.query_string
        if query_params:
            url = f"{BACKEND_URL.rstrip('/')}{backend_path}?{query_params}"
        else:
            url = f"{BACKEND_URL.rstrip('/')}{backend_path}"

        # Read raw body bytes first to ensure exact match with signature
        body_bytes = await request.read()
        body_str = body_bytes.decode('utf-8') if body_bytes else ""

        _LOGGER.debug("Proxy POST body: %s", body_str[:200])

        timestamp = str(int(time.time()))
        # Use user_key from request header if provided, otherwise generate from HA
        user_key = request.headers.get('X-User-Key') or self._get_user_key()
        signature = self._generate_signature(method, backend_path, timestamp, body_str)

        _LOGGER.debug("Proxy signature debug: method=%s path=%s body_length=%d user_key=%s", method, backend_path, len(body_str), user_key[:20] if user_key else 'None')

        headers = {
            "X-Signature": signature,
            "X-Timestamp": timestamp,
            "X-User-Key": user_key,
            "Content-Type": "application/json"
        }

        async with aiohttp.ClientSession() as session:
            try:
                _LOGGER.debug("Proxy calling backend: %s", url)
                # Send body as bytes to ensure exact content matches signature
                async with session.request(method, url, data=body_bytes if body_bytes else None, headers=headers) as resp:
                    resp_data = await resp.json()
                    if resp.status != 200:
                        _LOGGER.warning("Backend returned %d: %s", resp.status, resp_data)
                    return self.json(resp_data, resp.status)
            except Exception as e:
                _LOGGER.error("Proxy error: %s", e)
                return self.json({"error": str(e)}, 500)

    async def get(self, request, path):
        return await self.handle(request, path)

    async def post(self, request, path):
        return await self.handle(request, path)

class InstruMaticDownloadView(HomeAssistantView):
    """Download proxy to bypass CORS."""
    url = "/api/instrumatic/download"
    name = "api:instrumatic:download"
    requires_auth = False

    def __init__(self, hass):
        self.hass = hass

    async def get(self, request):
        url = request.query.get("url")
        if not url:
            return self.json({"error": "Missing url"}, 400)

        session = async_get_clientsession(self.hass)
        
        # Add browser-like headers to avoid blocking
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/pdf,*/*",
            "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1"
        }
        
        try:
            _LOGGER.info("Downloading PDF from: %s", url[:100])
            async with session.get(url, headers=headers, timeout=30, allow_redirects=True) as resp:
                if resp.status == 403:
                    _LOGGER.warning("Access forbidden (403) for URL: %s", url[:100])
                    return self.json({"error": "Access denied by website. Please download manually."}, 403)
                elif resp.status == 404:
                    _LOGGER.warning("PDF not found (404) at URL: %s", url[:100])
                    return self.json({"error": "PDF file not found at this URL"}, 404)
                elif resp.status != 200:
                    _LOGGER.error("Download failed with status %d from URL: %s", resp.status, url[:100])
                    return self.json({"error": f"Download failed: {resp.status}. Website may be blocking automated access."}, resp.status)
                
                content = await resp.read()
                if not content or len(content) < 100:  # PDF files should be larger
                    _LOGGER.warning("Downloaded file is too small to be a valid PDF")
                    return self.json({"error": "Downloaded file is too small or invalid"}, 400)
                
                return web.Response(body=content, content_type=resp.content_type or "application/pdf")
        except asyncio.TimeoutError:
            _LOGGER.error("Download timeout for URL: %s", url[:100])
            return self.json({"error": "Download timeout. Website may be slow or blocking access."}, 408)
        except Exception as e:
            _LOGGER.error("Download error for URL %s: %s", url[:100], str(e))
            return self.json({"error": f"Download failed: {str(e)}. Try downloading manually."}, 500)

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok
