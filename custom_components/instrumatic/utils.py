"""Utilities for InstruMatic."""
from __future__ import annotations
from datetime import datetime, date, timedelta
import dateutil.parser
import re

FAR_FUTURE = date(2099, 12, 31)

def calculate_next_date(task: dict, installation_date_str: str | None) -> date | None:
    """Logic to calculate next service date based on periodicity."""
    # Manual override takes precedence
    manual_date = task.get("manualNextDate")
    if manual_date and str(manual_date).strip():
        try:
            return dateutil.parser.parse(str(manual_date)).date()
        except:
            pass

    if task.get("isOneTime") and task.get("lastCompletedDate"):
        return FAR_FUTURE

    # Base date for calculation
    last_date_str = task.get("lastCompletedDate")
    base_date = None

    if last_date_str and str(last_date_str).strip():
        try:
            # Handle both YYYY-MM-DD and DD.MM.YYYY
            if "." in str(last_date_str):
                base_date = datetime.strptime(str(last_date_str), "%d.%m.%Y").date()
            else:
                base_date = dateutil.parser.parse(str(last_date_str)).date()
        except:
            pass

    if not base_date and installation_date_str and str(installation_date_str).strip():
        try:
            base_date = dateutil.parser.parse(str(installation_date_str)).date()
        except:
            pass

    if not base_date:
        base_date = date.today()

    periodicity = str(task.get("periodicity", "1 year")).lower()

    # Simple parser for periodicity (matching JS logic)
    nums = re.findall(r'\d+', periodicity)
    number = int(nums[0]) if nums else 1

    if any(x in periodicity for x in ["день", "дн", "day"]):
        res = base_date + timedelta(days=number)
    elif any(x in periodicity for x in ["нед", "week"]):
        res = base_date + timedelta(weeks=number)
    elif any(x in periodicity for x in ["мес", "month"]):
        res = base_date + timedelta(days=number * 30)
    elif any(x in periodicity for x in ["год", "лет", "year"]):
        res = base_date + timedelta(days=number * 365)
    elif any(x in periodicity for x in ["квартал", "quarter"]):
        res = base_date + timedelta(days=number * 91)
    else:
        res = base_date + timedelta(days=365)

    return res

def update_equipment_next_maintenance(data: dict, equipment_id: str | None):
    """Update the next_maintenance field for a specific equipment."""
    if not equipment_id:
        return

    equipment = next((e for e in data.get("equipment", []) if e.get("id") == equipment_id), None)
    if not equipment:
        return

    tasks = [t for t in data.get("tasks", []) if t.get("equipmentId") == equipment_id]
    if not tasks:
        equipment["next_maintenance"] = "Не запланировано"
        equipment["next_maintenance_task"] = None
        return

    next_dates = []
    installation_date = equipment.get("installationDate")

    for task in tasks:
        nd = calculate_next_date(task, installation_date)
        if nd and nd != FAR_FUTURE:
            next_dates.append((nd, task.get("taskName")))

    if next_dates:
        # Sort by date
        next_dates.sort(key=lambda x: x[0])
        earliest_date, task_name = next_dates[0]
        equipment["next_maintenance"] = earliest_date.isoformat()
        equipment["next_maintenance_task"] = task_name
    else:
        equipment["next_maintenance"] = "Не запланировано"
        equipment["next_maintenance_task"] = None

def update_all_next_maintenance(data: dict):
    """Update next_maintenance for all equipment."""
    for equipment in data.get("equipment", []):
        update_equipment_next_maintenance(data, equipment.get("id"))
