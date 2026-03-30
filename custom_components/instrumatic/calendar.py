"""Support for InstruMatic calendar."""
from __future__ import annotations

import logging
from datetime import datetime, date, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN, DATA_COORDINATOR
from .utils import calculate_next_date, FAR_FUTURE

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the InstruMatic calendar platform."""
    coordinator = hass.data[DOMAIN][config_entry.entry_id][DATA_COORDINATOR]
    async_add_entities([InstruMaticCalendar(coordinator)])

class InstruMaticCalendar(CalendarEntity):
    """Representation of an InstruMatic Calendar."""

    def __init__(self, coordinator: DataUpdateCoordinator) -> None:
        """Initialize the calendar."""
        self.coordinator = coordinator
        self._attr_name = "InstruMatic"
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_calendar"

    @property
    def event(self) -> CalendarEvent | None:
        """Return the next upcoming event."""
        data = self.coordinator.data
        if not data:
            return None

        events = self._get_all_events(
            datetime.now(),
            datetime.now() + timedelta(days=365)
        )
        if not events:
            return None

        # Sort events by start date
        events.sort(key=lambda x: x.start)
        return events[0]

    def _get_all_events(self, start_dt: datetime, end_dt: datetime) -> list[CalendarEvent]:
        """Get all events in range."""
        data = self.coordinator.data
        if not data:
            return []

        equipment_map = {e["id"]: e for e in data.get("equipment", [])}
        events = []

        for task in data.get("tasks", []):
            eq_id = task.get("equipmentId")
            eq = equipment_map.get(eq_id)
            if not eq:
                continue

            next_date = calculate_next_date(task, eq.get("installationDate"))
            if not next_date or next_date == FAR_FUTURE:
                continue

            # Check if date is within requested range
            if start_dt.date() <= next_date <= end_dt.date():
                events.append(
                    CalendarEvent(
                        summary=f"{eq['name']}: {task['taskName']}",
                        start=next_date,
                        end=next_date + timedelta(days=1),
                        description=f"Обслуживание: {task['taskName']}\nОборудование: {eq['name']}\nЛокация: {eq.get('location', '—')}",
                        location=eq.get("location")
                    )
                )
        return events

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        """Return calendar events between start and end date."""
        return self._get_all_events(start_date, end_date)
