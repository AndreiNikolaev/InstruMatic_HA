"""Sensor platform for InstruMatic."""
from __future__ import annotations

import logging
from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN, DATA_COORDINATOR

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up InstruMatic sensors."""
    coordinator = hass.data[DOMAIN][entry.entry_id][DATA_COORDINATOR]

    # List of already created IDs to avoid duplicates
    current_ids = set()

    @callback
    def async_discover_entities():
        """Discover new entities in coordinator data."""
        new_entities = []
        for equipment in coordinator.data.get("equipment", []):
            equip_id = equipment.get("id")
            if equip_id not in current_ids:
                new_entities.append(InstruMaticEquipmentSensor(coordinator, equipment))
                current_ids.add(equip_id)

        if new_entities:
            async_add_entities(new_entities)

    # 1. Initial load
    async_discover_entities()

    # 2. Subscribe to updates (signal from __init__.py)
    # Use string directly to avoid import issues with SIGNAL_EQUIPMENT_UPDATED
    entry.async_on_unload(
        async_dispatcher_connect(hass, f"{DOMAIN}_equipment_updated", async_discover_entities)
    )

class InstruMaticEquipmentSensor(CoordinatorEntity, SensorEntity):
    """Equipment status sensor."""

    def __init__(self, coordinator, equipment: dict) -> None:
        """Initialize sensor."""
        super().__init__(coordinator)
        self._equipment_id = equipment.get("id")
        self._attr_name = f"InstruMatic: {equipment.get('name')}"
        self._attr_unique_id = f"instrumatic_{self._equipment_id}"
        self._attr_icon = "mdi:tools"

    @property
    def equipment_data(self):
        """Helper method to get current data from coordinator."""
        for item in self.coordinator.data.get("equipment", []):
            if item.get("id") == self._equipment_id:
                return item
        return None

    @property
    def available(self) -> bool:
        """Sensor is available only if equipment exists in list."""
        return self.equipment_data is not None

    @property
    def native_value(self) -> str:
        """State is maintenance date."""
        data = self.equipment_data
        return data.get("next_maintenance", "Not scheduled") if data else None

    @property
    def extra_state_attributes(self) -> dict:
        """Attributes."""
        data = self.equipment_data
        if not data:
            return {}
        return {
            "brand": data.get("brand"),
            "model": data.get("model"),
            "location": data.get("location"),
            "rules": data.get("importantRules"),
        }
