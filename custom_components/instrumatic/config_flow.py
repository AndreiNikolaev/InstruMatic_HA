"""Config flow for InstruMatic integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

class InstruMaticConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle config flow for InstruMatic."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """First step of user configuration."""
        if user_input is not None:
            # If user clicked "Submit", create entry
            return self.async_create_entry(title="InstruMatic", data=user_input)

        # Show welcome form
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
            description_placeholders={
                "welcome_message": "Welcome to InstruMatic! Click 'Submit' to start."
            },
        )
